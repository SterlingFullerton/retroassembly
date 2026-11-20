package web

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/failure"
)

// Signing in with an OIDC provider, as src/server/redirect-routes.ts does with openid-client: /login/oidc sends the
// browser to the provider with a PKCE challenge, and /login/oidc/callback takes it back, checks what the provider
// answers, finds or makes the account and starts a session

const oidcCallbackPath = "/login/oidc/callback"

// The values the provider is to send back, kept in cookies only the callback is sent
var oidcFlowCookies = []string{"oidc-code-verifier", "oidc-nonce", "oidc-redirect-to", "oidc-state"}

// oidcProvider is the provider's configuration, read from its discovery document the first time it's needed. A read
// that fails is tried again next time
type oidcProvider struct {
	// What talks to the provider: over https only, as openid-client does
	client *http.Client
	// The issuer, as the discovery document writes it
	issuer   string
	mutex    sync.Mutex
	provider *oidc.Provider
	// Whether the provider says which issuer a callback is from (RFC 9207), which is then checked
	sendsIssuer bool
}

// discoveryURL is where the issuer's discovery document is, as oauth4webapi puts it: after the issuer's own path
func discoveryURL(issuer *url.URL) string {
	discovery := *issuer
	discovery.Path = strings.Replace(discovery.Path+"/.well-known/openid-configuration", "//", "/", 1)
	discovery.RawPath = ""
	return discovery.String()
}

// sameURL compares two URLs as JavaScript's new URL(...).href would write them
func sameURL(a, b string) bool {
	normalize := func(value string) string {
		parsed, err := url.Parse(value)
		if err != nil {
			return value
		}
		parsed.Scheme = strings.ToLower(parsed.Scheme)
		parsed.Host = strings.ToLower(withoutDefaultPort(parsed.Scheme, parsed.Host))
		if parsed.Path == "" {
			parsed.Path = "/"
		}
		return parsed.String()
	}
	return normalize(a) == normalize(b)
}

func (s *Server) oidcProvider(ctx context.Context) (*oidc.Provider, bool, error) {
	s.oidc.mutex.Lock()
	defer s.oidc.mutex.Unlock()
	if s.oidc.provider != nil {
		return s.oidc.provider, s.oidc.sendsIssuer, nil
	}
	issuer, err := url.Parse(s.config.OIDC.Issuer)
	if err != nil {
		return nil, false, err
	}
	if err := requireHTTPS(issuer.String()); err != nil {
		return nil, false, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL(issuer), nil)
	if err != nil {
		return nil, false, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.oidc.client.Do(request)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("the OIDC discovery document answered %s", response.Status)
	}
	var metadata struct {
		oidc.ProviderConfig
		Algorithms  []string `json:"id_token_signing_alg_values_supported"`
		SendsIssuer bool     `json:"authorization_response_iss_parameter_supported"`
	}
	if err := json.NewDecoder(response.Body).Decode(&metadata); err != nil {
		return nil, false, err
	}
	if !sameURL(metadata.IssuerURL, issuer.String()) {
		return nil, false, errors.New("the OIDC discovery document is for another issuer")
	}
	for _, address := range []string{metadata.TokenURL, metadata.JWKSURL} {
		if err := requireHTTPS(address); err != nil {
			return nil, false, err
		}
	}
	metadata.ProviderConfig.Algorithms = metadata.Algorithms
	// Not tied to this request, as the provider is kept for later ones. Its keys are fetched with the same client
	s.oidc.provider = metadata.ProviderConfig.NewProvider(oidc.ClientContext(context.WithoutCancel(ctx), s.oidc.client))
	s.oidc.issuer = metadata.IssuerURL
	s.oidc.sendsIssuer = metadata.SendsIssuer
	return s.oidc.provider, s.oidc.sendsIssuer, nil
}

func requireHTTPS(address string) error {
	parsed, err := url.Parse(address)
	if err != nil {
		return err
	}
	if parsed.Scheme != "https" {
		return errors.New("only requests to HTTPS are allowed")
	}
	return nil
}

// oidcClient talks to the provider, trusting the system's certificate authorities and, as Node does, those in the file
// NODE_EXTRA_CA_CERTS names, for a provider with a certificate of its own
func oidcClient(extraCertificates string) *http.Client {
	if extraCertificates == "" {
		return &http.Client{Timeout: 30 * time.Second}
	}
	// Node warns about a file it can't use, and goes on without it
	extra := x509.NewCertPool()
	certificates, err := os.ReadFile(extraCertificates)
	if err != nil || !extra.AppendCertsFromPEM(certificates) {
		log.Printf("Ignoring extra certificates in %s: none could be read", extraCertificates)
		return &http.Client{Timeout: 30 * time.Second}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{
		// Checked below instead, against the system's authorities and then the extra ones: on macOS the system's can't be
		// added to
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("the OIDC provider sent no certificate")
			}
			intermediates := x509.NewCertPool()
			for _, certificate := range state.PeerCertificates[1:] {
				intermediates.AddCert(certificate)
			}
			options := x509.VerifyOptions{DNSName: state.ServerName, Intermediates: intermediates}
			_, err := state.PeerCertificates[0].Verify(options)
			if err == nil {
				return nil
			}
			options.Roots = extra
			if _, extraErr := state.PeerCertificates[0].Verify(options); extraErr == nil {
				return nil
			}
			return err
		},
	}
	return &http.Client{Timeout: 30 * time.Second, Transport: transport}
}

func withoutDefaultPort(scheme, host string) string {
	hostname, port, err := net.SplitHostPort(host)
	if err == nil && (scheme == "http" && port == "80" || scheme == "https" && port == "443") {
		if strings.Contains(hostname, ":") {
			return "[" + hostname + "]"
		}
		return hostname
	}
	return host
}

// publicOrigin is the address the browser reached the app at, as src/utils/server/request-url.ts reads it: the
// protocol and host a proxy in front says, if it says, else the request's own
func publicOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if protocol, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ","); strings.TrimSpace(protocol) == "http" ||
		strings.TrimSpace(protocol) == "https" {
		scheme = strings.TrimSpace(protocol)
	}
	host := r.Host
	if forwarded, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Host"), ","); strings.TrimSpace(forwarded) != "" {
		host = strings.TrimSpace(forwarded)
	}
	return scheme + "://" + strings.ToLower(withoutDefaultPort(scheme, host))
}

func (s *Server) oidcCallbackURL(r *http.Request) string {
	if s.config.OIDC.RedirectURI != "" {
		return s.config.OIDC.RedirectURI
	}
	return publicOrigin(r) + oidcCallbackPath
}

// The flow's cookies, and the session's, are sent only over https when either the app or the callback is reached over it
func (s *Server) oidcSecure(r *http.Request) bool {
	callback, err := url.Parse(s.oidcCallbackURL(r))
	return isSecure(r) || err == nil && callback.Scheme == "https"
}

// encodeURIComponent writes a cookie's value as Hono does
func encodeURIComponent(value string) string {
	var builder strings.Builder
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.IndexByte("-_.!~*'()", b) >= 0 {
			builder.WriteByte(b)
		} else {
			fmt.Fprintf(&builder, "%%%02X", b)
		}
	}
	return builder.String()
}

func flowCookie(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	if value, err := url.PathUnescape(cookie.Value); err == nil {
		return value
	}
	return cookie.Value
}

// GET /login/oidc
func (s *Server) loginWithOIDC(w http.ResponseWriter, r *http.Request) {
	if s.authMode != "oidc" {
		redirect(w, "/login")
		return
	}
	redirectTo := safeRedirectTo(r.URL.Query().Get("redirect_to"))
	if stateOf(r).user != nil {
		redirect(w, redirectTo)
		return
	}
	provider, _, err := s.oidcProvider(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	verifier, nonce, state := oauth2.GenerateVerifier(), oauth2.GenerateVerifier(), oauth2.GenerateVerifier()
	secure := s.oidcSecure(r)
	for _, cookie := range [][2]string{
		{"oidc-code-verifier", verifier}, {"oidc-nonce", nonce}, {"oidc-redirect-to", redirectTo}, {"oidc-state", state},
	} {
		http.SetCookie(w, &http.Cookie{
			HttpOnly: true, MaxAge: 10 * 60, Name: cookie[0], Path: oidcCallbackPath, SameSite: http.SameSiteLaxMode,
			Secure: secure, Value: encodeURIComponent(cookie[1]),
		})
	}
	authorization, err := url.Parse(provider.Endpoint().AuthURL)
	if err != nil {
		writeError(w, err)
		return
	}
	// In openid-client's order: the parameters given, then the client's
	parameters := [][2]string{
		{"code_challenge", oauth2.S256ChallengeFromVerifier(verifier)}, {"code_challenge_method", "S256"},
		{"nonce", nonce}, {"redirect_uri", s.oidcCallbackURL(r)}, {"scope", s.config.OIDC.Scopes}, {"state", state},
		{"client_id", s.config.OIDC.ClientID}, {"response_type", "code"},
	}
	// Any the provider's own address has stay first, but for those given here
	query := authorization.Query()
	for _, parameter := range parameters {
		query.Del(parameter[0])
	}
	var encoded []string
	if len(query) > 0 {
		encoded = append(encoded, query.Encode())
	}
	for _, parameter := range parameters {
		encoded = append(encoded, url.QueryEscape(parameter[0])+"="+url.QueryEscape(parameter[1]))
	}
	authorization.RawQuery = strings.Join(encoded, "&")
	redirect(w, authorization.String())
}

// GET /login/oidc/callback. Whatever goes wrong is logged, and the browser sent back to the login page
func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if s.authMode != "oidc" {
		redirect(w, "/login")
		return
	}
	redirectTo, err := s.finishOIDCLogin(w, r)
	if err != nil {
		log.Println("OIDC callback failed:", err)
		redirectTo = "/login?error=oidc_callback_failed"
	}
	for _, name := range oidcFlowCookies {
		http.SetCookie(w, &http.Cookie{MaxAge: -1, Name: name, Path: oidcCallbackPath})
	}
	redirect(w, redirectTo)
}

var errNoIDToken = errors.New("The OIDC response does not contain an ID token")

func (s *Server) finishOIDCLogin(w http.ResponseWriter, r *http.Request) (string, error) {
	verifier, nonce, state := flowCookie(r, "oidc-code-verifier"), flowCookie(r, "oidc-nonce"), flowCookie(r, "oidc-state")
	if verifier == "" || nonce == "" || state == "" {
		return "/login?error=oidc_invalid_state", nil
	}
	ctx := r.Context()
	provider, sendsIssuer, err := s.oidcProvider(ctx)
	if err != nil {
		return "", err
	}

	query := r.URL.Query()
	if query.Get("state") != state {
		return "", errors.New("unexpected state in the OIDC response")
	}
	if issuer := query.Get("iss"); (issuer != "" || sendsIssuer) && issuer != s.oidc.issuer {
		return "", errors.New("unexpected issuer in the OIDC response")
	}
	if problem := query.Get("error"); problem != "" {
		return "", fmt.Errorf("the OIDC provider answered %s: %s", problem, query.Get("error_description"))
	}
	code := query.Get("code")
	if code == "" {
		return "", errors.New("the OIDC response has no code")
	}

	exchange := oauth2.Config{
		ClientID: s.config.OIDC.ClientID, ClientSecret: s.config.OIDC.ClientSecret, Endpoint: provider.Endpoint(),
		RedirectURL: s.oidcCallbackURL(r),
	}
	// openid-client sends the client's secret in the request's body
	exchange.Endpoint.AuthStyle = oauth2.AuthStyleInParams
	token, err := exchange.Exchange(context.WithValue(ctx, oauth2.HTTPClient, s.oidc.client), code,
		oauth2.VerifierOption(verifier))
	if err != nil {
		return "", err
	}
	rawIDToken, _ := token.Extra("id_token").(string)
	if rawIDToken == "" {
		return "", errNoIDToken
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: s.config.OIDC.ClientID}).Verify(ctx, rawIDToken)
	if err != nil {
		return "", err
	}
	if idToken.Nonce != nonce {
		return "", errors.New("unexpected nonce in the ID token")
	}

	var claims struct {
		Roles    json.RawMessage `json:"roles"`
		Username any             `json:"preferred_username"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return "", err
	}
	username, roles, err := oidcUsernameAndRoles(claims.Username, claims.Roles, s.config.OIDC.RequiredRole != "")
	if err != nil {
		return "", err
	}
	if required := s.config.OIDC.RequiredRole; required != "" && !contains(roles, required) {
		return "", failure.New(http.StatusForbidden, "The OIDC identity does not have the required role")
	}

	userID, err := auth.OIDCUser(ctx, s.database, idToken.Issuer, idToken.Subject, username, client(r))
	if err != nil {
		return "", err
	}
	session, err := auth.CreateSession(ctx, s.database, userID, auth.MethodOIDC,
		time.Now().Add(s.config.OIDC.SessionMaxAge), client(r))
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Expires: time.Time(session.ExpiresAt), HttpOnly: true, Name: "token", Path: "/",
		SameSite: http.SameSiteLaxMode, Secure: s.oidcSecure(r), Value: session.Token,
	})
	return safeRedirectTo(flowCookie(r, "oidc-redirect-to")), nil
}

func contains(values []string, value string) bool {
	for _, each := range values {
		if each == value {
			return true
		}
	}
	return false
}

// oidcUsernameAndRoles reads the identity's username (preferred_username, trimmed) and roles (a string or a list of
// them), as getOidcUsernameAndRoles does. The roles must be valid only when a role is required
func oidcUsernameAndRoles(rawUsername any, rawRoles json.RawMessage, requireRoles bool) (string, []string, error) {
	username, _ := rawUsername.(string)
	if strings.TrimSpace(username) == "" {
		return "", nil, errors.New("The OIDC response does not contain a valid preferred_username claim")
	}
	var roles []string
	var single string
	var list []any
	switch {
	case json.Unmarshal(rawRoles, &single) == nil:
		roles = []string{single}
	case json.Unmarshal(rawRoles, &list) == nil:
		for _, role := range list {
			text, ok := role.(string)
			if !ok {
				if requireRoles {
					return "", nil, errors.New("The OIDC response does not contain a valid roles claim")
				}
				roles = nil
				break
			}
			roles = append(roles, text)
		}
	case requireRoles:
		return "", nil, errors.New("The OIDC response does not contain a valid roles claim")
	}
	return strings.TrimSpace(username), roles, nil
}
