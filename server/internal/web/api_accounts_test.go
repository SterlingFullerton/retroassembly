package web

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

type account struct {
	ID          string `json:"id"`
	IsSuper     bool   `json:"isSuper"`
	LibraryMode int    `json:"libraryMode"`
	Username    string `json:"username"`
}

func TestAccountsAreForTheAdmin(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	player := api.register(t, "player")

	var accounts []account
	admin.expectJSON(http.StatusOK, &accounts, admin.get("/api/v1/users"))
	if len(accounts) != 2 || accounts[0].ID != admin.id || !accounts[0].IsSuper || accounts[1].IsSuper {
		t.Fatalf("accounts: %+v", accounts)
	}

	// Everyone else is refused every part of it
	player.expect(http.StatusForbidden, player.get("/api/v1/users"))
	player.expect(http.StatusForbidden, player.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-friend"}, "username": {"friend"}}))
	player.expect(http.StatusForbidden, player.form(http.MethodPatch, "/api/v1/users/"+admin.id,
		url.Values{"libraryMode": {"1"}}))
	player.expect(http.StatusForbidden, player.send(http.MethodDelete, "/api/v1/users/"+admin.id, "", nil))
	if api.count(t, `SELECT count(*) FROM users WHERE status = 1`) != 2 {
		t.Fatal("an account was added or deleted by someone who isn't the admin")
	}

	// As is someone not signed in
	stranger := api.browser(t)
	stranger.expect(http.StatusUnauthorized, stranger.get("/api/v1/users"))
	stranger.expect(http.StatusUnauthorized, stranger.send(http.MethodDelete, "/api/v1/users/"+player.id, "", nil))
}

func TestAdminManagesAccounts(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")

	var added account
	admin.expectJSON(http.StatusOK, &added, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"libraryMode": {"1"}, "password": {"password-friend"}, "username": {"friend"}}))
	if added.Username != "friend" || added.LibraryMode != 1 {
		t.Fatalf("added: %+v", added)
	}
	admin.expect(http.StatusConflict, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-friend"}, "username": {"friend"}}))
	admin.expect(http.StatusBadRequest, admin.form(http.MethodPost, "/api/v1/users", url.Values{"username": {"nopassword"}}))

	// The new account can sign in, and shares the admin's library
	friend := api.login(t, "friend")
	if friend.id != added.ID {
		t.Fatalf("signed in as %s, not %s", friend.id, added.ID)
	}

	var changed account
	admin.expectJSON(http.StatusOK, &changed, admin.form(http.MethodPatch, "/api/v1/users/"+friend.id,
		url.Values{"libraryMode": {"0"}}))
	if changed.LibraryMode != 0 {
		t.Fatalf("changed: %+v", changed)
	}
	admin.expect(http.StatusBadRequest, admin.form(http.MethodPatch, "/api/v1/users/"+friend.id, url.Values{}))
	admin.expect(http.StatusUnprocessableEntity, admin.form(http.MethodPatch, "/api/v1/users/"+admin.id,
		url.Values{"libraryMode": {"1"}}))
	admin.expect(http.StatusNotFound, admin.form(http.MethodPatch, "/api/v1/users/nobody",
		url.Values{"libraryMode": {"1"}}))

	admin.expect(http.StatusUnprocessableEntity, admin.send(http.MethodDelete, "/api/v1/users/"+admin.id, "", nil))
	admin.expect(http.StatusOK, admin.send(http.MethodDelete, "/api/v1/users/"+friend.id, "", nil))

	// Deleting an account ends its sessions
	friend.expect(http.StatusUnauthorized, friend.get("/api/v1/preference"))
	var accounts []account
	admin.expectJSON(http.StatusOK, &accounts, admin.get("/api/v1/users"))
	if len(accounts) != 1 {
		t.Fatalf("accounts: %+v", accounts)
	}
}

// Only the first account signs up; the admin adds the others. New passwords are at least 8 characters
func TestRegistrationOnlyForTheFirstAccount(t *testing.T) {
	api := newAPI(t)
	stranger := api.browser(t)
	stranger.expect(http.StatusBadRequest, stranger.form(http.MethodPost, "/api/v1/auth/register",
		url.Values{"password": {"short"}, "username": {"admin"}}))
	admin := api.register(t, "admin")

	stranger.expect(http.StatusForbidden, stranger.form(http.MethodPost, "/api/v1/auth/register",
		url.Values{"password": {"password-stranger"}, "username": {"stranger"}}))
	if api.count(t, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("a second account signed up")
	}
	admin.expect(http.StatusBadRequest, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"1234567"}, "username": {"friend"}}))
	admin.expect(http.StatusBadRequest, admin.form(http.MethodPatch, "/api/v1/auth/password",
		url.Values{"new_password": {"short"}, "password": {"password-admin"}}))
	admin.expect(http.StatusOK, admin.form(http.MethodPatch, "/api/v1/auth/password",
		url.Values{"new_password": {"a longer one"}, "password": {"password-admin"}}))
}

// Wrong passwords for an account, from one address, are refused for a while after SIGN_IN_ATTEMPTS, before any is
// checked
func TestSignInAttemptsAreLimited(t *testing.T) {
	t.Setenv("SIGN_IN_ATTEMPTS", "3")
	api := newAPI(t)
	api.register(t, "admin")
	guesser := api.browser(t)
	for range 3 {
		guesser.expect(http.StatusUnauthorized, guesser.form(http.MethodPost, "/api/v1/auth/login",
			url.Values{"password": {"wrong password"}, "username": {"admin"}}))
	}
	guesser.expect(http.StatusTooManyRequests, guesser.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-admin"}, "username": {"admin"}}))
}

// With OPEN_SIGNUP anyone makes an account at the login page, and with SIGNUP_SHARES_LIBRARY it shares the admin's
// library; the first account is the admin all the same
func TestOpenSignup(t *testing.T) {
	for _, shares := range []bool{false, true} {
		t.Setenv("OPEN_SIGNUP", "true")
		t.Setenv("SIGNUP_SHARES_LIBRARY", map[bool]string{false: "false", true: "true"}[shares])
		api := newAPI(t)
		var page struct {
			SignupOpen bool `json:"signupOpen"`
		}
		stranger := api.browser(t)
		stranger.expectJSON(http.StatusOK, &page, stranger.get("/api/v1/pages/login"))
		if !page.SignupOpen {
			t.Fatal("the login page doesn't say sign-up is open")
		}
		var accounts []account
		for _, name := range []string{"admin", "friend"} {
			stranger.expect(http.StatusOK, stranger.form(http.MethodPost, "/api/v1/auth/register",
				url.Values{"password": {"password-" + name}, "username": {name}}))
		}
		admin := api.login(t, "admin")
		admin.expectJSON(http.StatusOK, &accounts, admin.get("/api/v1/users"))
		want := map[bool]int{false: 0, true: 1}[shares]
		if len(accounts) != 2 || !accounts[0].IsSuper || accounts[0].LibraryMode != 0 || accounts[1].LibraryMode != want {
			t.Fatalf("shares %v: %+v", shares, accounts)
		}
	}
}

// A session's token can't be guessed, and a password session renews itself while used, but not past 90 days
func TestSessionLifetime(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	var token string
	if err := api.database.QueryRow(`SELECT token FROM sessions WHERE user_id = ?`, admin.id).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if len(token) != 43 {
		t.Fatalf("token %q", token)
	}

	day := int64(24 * time.Hour / time.Millisecond)
	now := time.Now().UnixMilli()
	started := now - 89*day
	if _, err := api.database.Exec(`UPDATE sessions SET created_at = ?, expires_at = ?, last_activity_at = ? WHERE token = ?`,
		started, now+day/2, now-day, token); err != nil {
		t.Fatal(err)
	}
	admin.expect(http.StatusOK, admin.get("/api/v1/preference"))
	var expiresAt int64
	if err := api.database.QueryRow(`SELECT expires_at FROM sessions WHERE token = ?`, token).Scan(&expiresAt); err != nil {
		t.Fatal(err)
	}
	if expiresAt != started+90*day {
		t.Fatalf("renewed to %d days after it started", (expiresAt-started)/day)
	}

	if _, err := api.database.Exec(`UPDATE sessions SET expires_at = ? WHERE token = ?`, now-1, token); err != nil {
		t.Fatal(err)
	}
	admin.expect(http.StatusUnauthorized, admin.get("/api/v1/preference"))
}

func TestUsernamesFollowTheRule(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	add := func(username string) response {
		return admin.form(http.MethodPost, "/api/v1/users",
			url.Values{"libraryMode": {"1"}, "password": {"password-friend"}, "username": {username}})
	}

	for _, username := range []string{"", "   ", "a", "two words", "<b>bold</b>", "name@host", "abcdefghijklmnopqrstuvwxyz0123456"} {
		admin.expect(http.StatusBadRequest, add(username))
	}
	for _, username := range []string{"Friend", "jo", "anna.b-2_x", "Zoë", "太郎"} {
		admin.expect(http.StatusOK, add(username))
	}
	// A name taken in other capitals is taken
	admin.expect(http.StatusConflict, add("friend"))
	admin.expect(http.StatusConflict, add("ADMIN"))
	if count := api.count(t, `SELECT count(*) FROM users WHERE status = 1`); count != 6 {
		t.Fatalf("%d accounts, not the admin and the 5 added", count)
	}

	// And signs in whatever capitals it's typed with
	friend := api.browser(t)
	friend.expect(http.StatusOK, friend.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-friend"}, "username": {"fRIEND"}}))
	friend.expect(http.StatusUnauthorized, friend.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-friend"}, "username": {"friendly"}}))
}

func TestLibraryModeIsOwnOrShared(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	player := api.register(t, "player")

	for _, mode := range []string{"2", "-1", "0.5", "NaN"} {
		admin.expect(http.StatusBadRequest, admin.form(http.MethodPatch, "/api/v1/users/"+player.id,
			url.Values{"libraryMode": {mode}}))
		admin.expect(http.StatusBadRequest, admin.form(http.MethodPost, "/api/v1/users",
			url.Values{"libraryMode": {mode}, "password": {"password-other"}, "username": {"other"}}))
	}
	if mode := api.count(t, `SELECT library_mode FROM users WHERE id = ?`, player.id); mode != 0 {
		t.Fatalf("library mode is %d", mode)
	}
}

func TestAdminResetsAForgottenPassword(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	player := api.register(t, "player")
	other := api.register(t, "other")
	reset := func(by *apiUser, id, password string) response {
		return by.form(http.MethodPut, "/api/v1/users/"+id+"/password", url.Values{"new_password": {password}})
	}

	// Only the admin, only for someone else, and only a password long enough
	other.expect(http.StatusForbidden, reset(other, player.id, "another-password"))
	stranger := api.browser(t)
	stranger.expect(http.StatusUnauthorized, reset(stranger, player.id, "another-password"))
	admin.expect(http.StatusUnprocessableEntity, reset(admin, admin.id, "another-password"))
	admin.expect(http.StatusBadRequest, reset(admin, player.id, "short"))
	admin.expect(http.StatusNotFound, reset(admin, "nobody", "another-password"))
	player.expect(http.StatusOK, player.get("/api/v1/preference"))

	admin.expect(http.StatusOK, reset(admin, player.id, "another-password"))

	// They're signed out everywhere, the old password is gone and the new one works
	player.expect(http.StatusUnauthorized, player.get("/api/v1/preference"))
	again := api.browser(t)
	again.expect(http.StatusUnauthorized, again.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-player"}, "username": {"player"}}))
	again.expect(http.StatusOK, again.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"another-password"}, "username": {"player"}}))
	// Nobody else is touched
	admin.expect(http.StatusOK, admin.get("/api/v1/preference"))
	other.expect(http.StatusOK, other.get("/api/v1/preference"))
}
