package web

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// sendFrom sends a request as if passed along by a reverse proxy, with the X-Forwarded-For it would add
func (u *apiUser) sendFrom(forwardedFor, method, path string, values url.Values) response {
	u.t.Helper()
	request, err := http.NewRequest(method, u.api.app.URL+path, strings.NewReader(values.Encode()))
	if err != nil {
		u.t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if forwardedFor != "" {
		request.Header.Set("X-Forwarded-For", forwardedFor)
	}
	answer, err := u.client.Do(request)
	if err != nil {
		u.t.Fatal(err)
	}
	defer answer.Body.Close()
	content, err := io.ReadAll(answer.Body)
	if err != nil {
		u.t.Fatal(err)
	}
	return response{body: content, status: answer.StatusCode}
}

func (u *apiUser) ownAddress(forwardedFor string) string {
	u.t.Helper()
	var answer struct {
		Address string `json:"address"`
	}
	content := u.expect(http.StatusOK, u.sendFrom(forwardedFor, http.MethodGet, "/api/v1/play_together/address", nil))
	if err := json.Unmarshal(content, &answer); err != nil {
		u.t.Fatal(err)
	}
	return answer.Address
}

// Without TRUSTED_PROXIES, X-Forwarded-For is whatever the sender wrote, and is ignored
func TestForwardedForIsIgnoredFromAnywhere(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	if address := admin.ownAddress("10.0.0.9"); address != "127.0.0.1" {
		t.Fatalf("address %q, not the connection's", address)
	}
}

// Through a trusted proxy, the client is the last address the proxies didn't add themselves: anything before it the
// client wrote
func TestTrustedProxiesSayWhoTheClientIs(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1, 172.16.0.0/12")
	api := newAPI(t)
	admin := api.register(t, "admin")
	for forwardedFor, want := range map[string]string{
		"":                                 "127.0.0.1",
		"100.64.0.7":                       "100.64.0.7",
		"10.0.0.9, 100.64.0.7":             "100.64.0.7",
		"10.0.0.9, 100.64.0.7, 172.16.6.2": "100.64.0.7",
		"172.16.6.2":                       "172.16.6.2",
		"not an address, 100.64.0.7":       "100.64.0.7",
		"100.64.0.7, not an address":       "127.0.0.1",
		"::ffff:100.64.0.7":                "100.64.0.7",
	} {
		if address := admin.ownAddress(forwardedFor); address != want {
			t.Errorf("X-Forwarded-For %q: %q, want %q", forwardedFor, address, want)
		}
	}
}

// Behind the proxy, one visitor's wrong passwords and new accounts count against their own address alone
func TestSignInLimitsAreByTheClientBehindAProxy(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	t.Setenv("OPEN_SIGNUP", "true")
	t.Setenv("SIGN_IN_ATTEMPTS", "2")
	api := newAPI(t)
	api.register(t, "admin")
	guesser, friend := api.browser(t), api.browser(t)
	for index := range 2 * addressFailuresPerAccount {
		guesser.sendFrom("100.64.0.66", http.MethodPost, "/api/v1/auth/login",
			url.Values{"password": {"wrong-password"}, "username": {"someone" + string(rune('a'+index))}})
	}
	guesser.expect(http.StatusTooManyRequests, guesser.sendFrom("100.64.0.66", http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-admin"}, "username": {"admin"}}))
	friend.expect(http.StatusOK, friend.sendFrom("100.64.0.7", http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-admin"}, "username": {"admin"}}))

	signUp := func(from, name string) response {
		return guesser.sendFrom(from, http.MethodPost, "/api/v1/auth/register",
			url.Values{"password": {"password-" + name}, "username": {name}})
	}
	for index := range maxSignUpsPerAddress {
		guesser.expect(http.StatusOK, signUp("100.64.0.55", "made"+string(rune('a'+index))))
	}
	guesser.expect(http.StatusTooManyRequests, signUp("100.64.0.55", "onemore"))
	// Refused before the account is made
	if api.count(t, `SELECT count(*) FROM users WHERE username = 'onemore'`) != 0 {
		t.Fatal("the account was made all the same")
	}
	friend.expect(http.StatusOK, signUp("100.64.0.7", "friend"))
}
