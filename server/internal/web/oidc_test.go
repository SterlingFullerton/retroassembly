package web

import (
	"database/sql"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/oidctest"
	"retroassembly/server/internal/shared"
)

type oidcSetup struct {
	app      *httptest.Server
	database *sql.DB
	provider *oidctest.Provider
	server   *Server
}

func newOIDCSetup(t *testing.T, requiredRole string) *oidcSetup {
	t.Helper()
	provider, err := oidctest.New()
	if err != nil {
		t.Fatal(err)
	}
	providerServer := httptest.NewTLSServer(provider.Handler())
	t.Cleanup(providerServer.Close)
	provider.Issuer = providerServer.URL

	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	data, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	c := config.Config{OIDC: config.OIDC{
		ClientID: oidctest.ClientID, ClientSecret: oidctest.ClientSecret, Issuer: provider.Issuer,
		RequiredRole: requiredRole, Scopes: "openid profile", SessionMaxAge: time.Hour,
	}}
	server, err := New(c, database, "oidc", data)
	if err != nil {
		t.Fatal(err)
	}
	server.oidc.client = providerServer.Client()
	routes := http.NewServeMux()
	routes.HandleFunc("GET /login/oidc", server.loginWithOIDC)
	routes.HandleFunc("GET "+oidcCallbackPath, server.oidcCallback)
	app := httptest.NewServer(server.globals(routes))
	t.Cleanup(app.Close)
	return &oidcSetup{app: app, database: database, provider: provider, server: server}
}

// browser follows redirects through the provider, and stops at the first that leads back into the app, past the login
func (o *oidcSetup) browser(t *testing.T) *http.Client {
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = o.server.oidc.client.Transport.(*http.Transport).TLSClientConfig
	return &http.Client{Jar: jar, Transport: transport, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if strings.HasPrefix(request.URL.String(), o.app.URL) && !strings.HasPrefix(request.URL.Path, "/login/oidc") {
			return http.ErrUseLastResponse
		}
		return nil
	}}
}

// login signs in with the provider's current identity, and says where the app sent the browser in the end
func (o *oidcSetup) login(t *testing.T, browser *http.Client, redirectTo string) string {
	t.Helper()
	response, err := browser.Get(o.app.URL + "/login/oidc?redirect_to=" + url.QueryEscape(redirectTo))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("answered %d", response.StatusCode)
	}
	return response.Header.Get("Location")
}

func (o *oidcSetup) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := o.database.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestOIDCLogin(t *testing.T) {
	o := newOIDCSetup(t, "")
	browser := o.browser(t)
	if location := o.login(t, browser, "/library/roms?sort=name"); location != "/library/roms?sort=name" {
		t.Fatalf("sent to %q", location)
	}
	if o.count(t, `SELECT count(*) FROM users WHERE username = 'oidc-user' AND password_hash IS NULL`) != 1 {
		t.Fatal("no account made")
	}
	if o.count(t, `SELECT count(*) FROM oidc_identities WHERE issuer = ? AND subject = 'subject-1'`, o.provider.Issuer) != 1 {
		t.Fatal("identity not linked")
	}
	var expiresAt, createdAt int64
	if err := o.database.QueryRow(`SELECT expires_at, created_at FROM sessions WHERE authentication_method = 'oidc'`).
		Scan(&expiresAt, &createdAt); err != nil {
		t.Fatal(err)
	}
	if lasts := time.Duration(expiresAt-createdAt) * time.Millisecond; lasts < time.Hour-time.Second || lasts > time.Hour+time.Second {
		t.Fatalf("session lasts %v", lasts)
	}

	appURL, _ := url.Parse(o.app.URL + oidcCallbackPath)
	for _, cookie := range browser.Jar.Cookies(appURL) {
		if strings.HasPrefix(cookie.Name, "oidc-") {
			t.Fatalf("%s left behind", cookie.Name)
		}
	}
	// Signed in, the login goes straight where it's asked to
	response, err := browser.Get(o.app.URL + "/login/oidc?redirect_to=%2F%2Fevil.example")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if location := response.Header.Get("Location"); location != "/library" {
		t.Fatalf("signed in, sent to %q", location)
	}

	// The same identity, under a new username, is the same account
	o.provider.SetIdentity(oidctest.Identity{Subject: "subject-1", Username: "renamed"})
	if location := o.login(t, o.browser(t), ""); location != "/library" {
		t.Fatalf("sent to %q", location)
	}
	if o.count(t, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("a second account was made")
	}
}

func TestOIDCLinksAccounts(t *testing.T) {
	o := newOIDCSetup(t, "")
	if _, err := auth.CreateUser(t.Context(), o.database, "alice", "", 0, "oidc", auth.Client{}); err != nil {
		t.Fatal(err)
	}
	o.provider.SetIdentity(oidctest.Identity{Subject: "alice-1", Username: " alice "})
	if location := o.login(t, o.browser(t), "/library"); location != "/library" {
		t.Fatalf("sent to %q", location)
	}
	if o.count(t, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("not linked to the account with the username")
	}
	// Another identity can't take an account that's linked already
	o.provider.SetIdentity(oidctest.Identity{Subject: "alice-2", Username: "alice"})
	if location := o.login(t, o.browser(t), "/library"); location != "/login?error=oidc_callback_failed" {
		t.Fatalf("sent to %q", location)
	}
	// Nor sign in to a deleted account
	if _, err := o.database.Exec(`UPDATE users SET status = 0`); err != nil {
		t.Fatal(err)
	}
	o.provider.SetIdentity(oidctest.Identity{Subject: "alice-1", Username: "alice"})
	if location := o.login(t, o.browser(t), "/library"); location != "/login?error=oidc_callback_failed" {
		t.Fatalf("deleted account, sent to %q", location)
	}
}

// An account with a password is linked only when the setting allows it: anyone choosing that username on the provider
// could otherwise take it over
func TestOIDCPasswordAccounts(t *testing.T) {
	o := newOIDCSetup(t, "")
	if _, err := auth.CreateUser(t.Context(), o.database, "admin", "admin-pass-1", 0, "local", auth.Client{}); err != nil {
		t.Fatal(err)
	}
	o.provider.SetIdentity(oidctest.Identity{Subject: "chosen", Username: "admin"})
	if location := o.login(t, o.browser(t), "/library"); location != "/login?error=oidc_callback_failed" {
		t.Fatalf("linked to the account with a password: %q", location)
	}
	o.server.config.OIDC.LinkPasswordAccounts = true
	if location := o.login(t, o.browser(t), "/library"); location != "/library" {
		t.Fatalf("not linked with the setting: %q", location)
	}
	if o.count(t, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("a second account was made")
	}
}

func TestOIDCRequiredRole(t *testing.T) {
	o := newOIDCSetup(t, "player")
	for _, test := range []struct {
		roles any
		works bool
	}{
		{"player", true}, {[]string{"admin", "player"}, true}, {[]string{"admin"}, false}, {nil, false},
		{[]any{"player", 1}, false}, {7, false},
	} {
		o.provider.SetIdentity(oidctest.Identity{Roles: test.roles, Subject: "s", Username: "u"})
		want := "/login?error=oidc_callback_failed"
		if test.works {
			want = "/library"
		}
		if location := o.login(t, o.browser(t), ""); location != want {
			t.Errorf("roles %v: sent to %q", test.roles, location)
		}
	}
}

func TestOIDCRejects(t *testing.T) {
	o := newOIDCSetup(t, "")
	for _, username := range []any{nil, "  ", 5} {
		o.provider.SetIdentity(oidctest.Identity{Subject: "s", Username: username})
		if location := o.login(t, o.browser(t), ""); location != "/login?error=oidc_callback_failed" {
			t.Errorf("username %v: sent to %q", username, location)
		}
	}
	o.provider.SetIdentity(oidctest.Identity{Subject: "s", Username: "u"})
	o.provider.Nonce = "another"
	if location := o.login(t, o.browser(t), ""); location != "/login?error=oidc_callback_failed" {
		t.Errorf("another nonce: sent to %q", location)
	}
	o.provider.Nonce = ""
	if o.count(t, `SELECT count(*) FROM users`) != 0 {
		t.Fatal("an account was made")
	}

	// A callback without the login's cookies, or with another state
	browser := o.browser(t)
	response, err := browser.Get(o.app.URL + oidcCallbackPath + "?code=x&state=y")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if location := response.Header.Get("Location"); location != "/login?error=oidc_invalid_state" {
		t.Errorf("no cookies: sent to %q", location)
	}
	browser.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if request.URL.Path == oidcCallbackPath {
			query := request.URL.Query()
			query.Set("state", "forged")
			request.URL.RawQuery = query.Encode()
		}
		return o.browser(t).CheckRedirect(request, via)
	}
	if location := o.login(t, browser, ""); location != "/login?error=oidc_callback_failed" {
		t.Errorf("another state: sent to %q", location)
	}
}

// Only a provider reached over https is used, as openid-client does
func TestOIDCOverHTTP(t *testing.T) {
	o := newOIDCSetup(t, "")
	o.server.config.OIDC.Issuer = strings.Replace(o.provider.Issuer, "https:", "http:", 1)
	response, err := o.browser(t).Get(o.app.URL + "/login/oidc")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusInternalServerError {
		t.Fatalf("answered %d", response.StatusCode)
	}
}

func TestOIDCOff(t *testing.T) {
	o := newOIDCSetup(t, "")
	o.server.authMode = "local"
	for _, path := range []string{"/login/oidc", oidcCallbackPath} {
		response, err := o.browser(t).Get(o.app.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if location := response.Header.Get("Location"); location != "/login" {
			t.Errorf("%s sent to %q", path, location)
		}
	}
}

func TestOIDCUsernameAndRoles(t *testing.T) {
	username, roles, err := oidcUsernameAndRoles(" bob ", []byte(`[1, "x"]`), false)
	if err != nil || username != "bob" || roles != nil {
		t.Fatalf("%q %v %v", username, roles, err)
	}
	if _, _, err := oidcUsernameAndRoles("bob", []byte(`{"a": 1}`), true); err == nil {
		t.Fatal("an object taken for roles")
	}
	if _, roles, err := oidcUsernameAndRoles("bob", nil, false); err != nil || roles != nil {
		t.Fatalf("%v %v", roles, err)
	}
}

func TestPublicOrigin(t *testing.T) {
	for _, test := range []struct {
		host, protocol, forwardedHost, want string
	}{
		{"localhost:8000", "", "", "http://localhost:8000"},
		{"localhost:8000", "https, http", "Games.Example:443, other", "https://games.example"},
		{"localhost:8000", "ftp", "games.example:8080", "http://games.example:8080"},
		{"localhost:80", "", "", "http://localhost"},
	} {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.Host = test.host
		if test.protocol != "" {
			request.Header.Set("X-Forwarded-Proto", test.protocol)
		}
		if test.forwardedHost != "" {
			request.Header.Set("X-Forwarded-Host", test.forwardedHost)
		}
		if got := publicOrigin(request); got != test.want {
			t.Errorf("%+v: %q", test, got)
		}
	}
}
