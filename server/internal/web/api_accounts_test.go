package web

import (
	"net/http"
	"net/url"
	"testing"
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
