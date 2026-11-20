// Package oidctest is an OIDC provider for checking the login with OIDC: it approves every login at once, as whoever
// its Identity says, with the authorization code flow, PKCE and signed ID tokens.
package oidctest

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

const (
	ClientID     = "retroassembly"
	ClientSecret = "test-secret"
)

// Identity is who the provider signs in. Roles is the roles claim as it is: nil leaves it out
type Identity struct {
	Roles    any    `json:"roles"`
	Subject  string `json:"sub"`
	Username any    `json:"preferred_username"`
}

type grant struct {
	challenge   string
	identity    Identity
	nonce       string
	redirectURI string
}

type Provider struct {
	// The provider's address, which is its issuer. Set before it's used
	Issuer string
	// When set, the ID token's nonce is this instead of the one asked for
	Nonce string

	grants   map[string]grant
	identity Identity
	key      *rsa.PrivateKey
	mutex    sync.Mutex
}

func New() (*Provider, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	return &Provider{grants: map[string]grant{}, identity: Identity{Subject: "subject-1", Username: "oidc-user"}, key: key}, nil
}

// SetIdentity is who the next logins sign in as
func (p *Provider) SetIdentity(identity Identity) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.identity = identity
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func randomText() string {
	return rand.Text()
}

func (p *Provider) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"authorization_endpoint":                         p.Issuer + "/authorize",
			"authorization_response_iss_parameter_supported": true,
			"code_challenge_methods_supported":               []string{"S256"},
			"id_token_signing_alg_values_supported":          []string{"RS256"},
			"issuer":                                         p.Issuer,
			"jwks_uri":                                       p.Issuer + "/jwks",
			"response_types_supported":                       []string{"code"},
			"subject_types_supported":                        []string{"public"},
			"token_endpoint":                                 p.Issuer + "/token",
			"token_endpoint_auth_methods_supported":          []string{"client_secret_basic", "client_secret_post"},
		})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Algorithm: "RS256", Key: &p.key.PublicKey, KeyID: "key-1", Use: "sig"},
		}})
	})
	mux.HandleFunc("GET /authorize", p.authorize)
	mux.HandleFunc("POST /token", p.token)
	// Who the next logins sign in as, for checking a server that runs apart from the provider
	mux.HandleFunc("POST /identity", func(w http.ResponseWriter, r *http.Request) {
		var identity Identity
		if err := json.NewDecoder(r.Body).Decode(&identity); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		p.SetIdentity(identity)
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func (p *Provider) authorize(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	redirectURI := query.Get("redirect_uri")
	if query.Get("client_id") != ClientID || query.Get("response_type") != "code" ||
		query.Get("code_challenge_method") != "S256" || query.Get("code_challenge") == "" || redirectURI == "" {
		http.Error(w, "invalid authorization request", http.StatusBadRequest)
		return
	}
	code := randomText()
	p.mutex.Lock()
	p.grants[code] = grant{
		challenge: query.Get("code_challenge"), identity: p.identity, nonce: query.Get("nonce"), redirectURI: redirectURI,
	}
	p.mutex.Unlock()
	back, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	values := back.Query()
	values.Set("code", code)
	values.Set("iss", p.Issuer)
	values.Set("state", query.Get("state"))
	back.RawQuery = values.Encode()
	http.Redirect(w, r, back.String(), http.StatusFound)
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	clientID, secret, basic := r.BasicAuth()
	if !basic {
		clientID, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if clientID != ClientID || secret != ClientSecret {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_client"})
		return
	}
	p.mutex.Lock()
	granted, found := p.grants[r.PostForm.Get("code")]
	delete(p.grants, r.PostForm.Get("code"))
	nonce := p.Nonce
	p.mutex.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !found || r.PostForm.Get("grant_type") != "authorization_code" ||
		r.PostForm.Get("redirect_uri") != granted.redirectURI ||
		base64.RawURLEncoding.EncodeToString(sum[:]) != granted.challenge {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	if nonce == "" {
		nonce = granted.nonce
	}

	now := time.Now()
	claims := map[string]any{
		"aud": ClientID, "exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "iss": p.Issuer, "nonce": nonce,
		"preferred_username": granted.identity.Username, "sub": granted.identity.Subject,
	}
	if granted.identity.Roles != nil {
		claims["roles"] = granted.identity.Roles
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: p.key, KeyID: "key-1"}},
		(&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	idToken, err := signed.CompactSerialize()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": randomText(), "expires_in": 3600, "id_token": idToken, "token_type": "Bearer",
	})
}
