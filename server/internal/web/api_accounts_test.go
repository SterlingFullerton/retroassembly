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

// With OPEN_SIGNUP anyone makes an account at the login page: a player, who can't change the library. The first
// account is the admin all the same
func TestOpenSignup(t *testing.T) {
	t.Setenv("OPEN_SIGNUP", "true")
	api := newAPI(t)
	var page struct {
		SignupOpen bool `json:"signupOpen"`
	}
	stranger := api.browser(t)
	stranger.expectJSON(http.StatusOK, &page, stranger.get("/api/v1/pages/login"))
	if !page.SignupOpen {
		t.Fatal("the login page doesn't say sign-up is open")
	}
	for _, name := range []string{"admin", "friend"} {
		stranger.expect(http.StatusOK, stranger.form(http.MethodPost, "/api/v1/auth/register",
			url.Values{"password": {"password-" + name}, "username": {name}}))
	}
	admin := api.login(t, "admin")
	var accounts []roleAccount
	admin.expectJSON(http.StatusOK, &accounts, admin.get("/api/v1/users"))
	if len(accounts) != 2 || !accounts[0].IsSuper || accounts[0].Role != "admin" || accounts[1].Role != "player" {
		t.Fatalf("accounts: %+v", accounts)
	}
	added := admin.addGame("Quest (USA).nes")
	friend := api.login(t, "friend")
	friend.expect(http.StatusOK, friend.get("/api/v1/roms/"+added.ID+"/content"))
	friend.expect(http.StatusForbidden, friend.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameName": {"Mine"}}))
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

	// Letters from other alphabets look like these: "аdmin" has a Cyrillic а
	for _, username := range []string{"", "   ", "a", "two words", "<b>bold</b>", "name@host", "abcdefghijklmnopqrstuvwxyz0123456",
		"Zoë", "太郎", "аdmin", "Server", "s-e-r-v-e-r", "NAS", "5erver"} {
		admin.expect(http.StatusBadRequest, add(username))
	}
	for _, username := range []string{"Friend", "jo", "anna.b-2_x", "Mila"} {
		admin.expect(http.StatusOK, add(username))
	}
	// A name taken in other capitals is taken, and so is one that looks like another account's
	for _, username := range []string{"friend", "ADMIN", "adm1n", "Fr1end", "fr_iend", "anna.b-2_x.", "MiIa", "rni1a"} {
		admin.expect(http.StatusConflict, add(username))
	}
	if count := api.count(t, `SELECT count(*) FROM users WHERE status = 1`); count != 5 {
		t.Fatalf("%d accounts, not the admin and the 4 added", count)
	}
	// Accounts from before the rule keep their names, and sign in with them
	if _, err := api.database.Exec(`UPDATE users SET username = 'Zoë' WHERE username = 'Mila'`); err != nil {
		t.Fatal(err)
	}
	zoe := api.browser(t)
	zoe.expect(http.StatusOK, zoe.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-friend"}, "username": {"Zoë"}}))

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

type roleAccount struct {
	ID       string `json:"id"`
	IsSuper  bool   `json:"isSuper"`
	Role     string `json:"role"`
	Username string `json:"username"`
}

func TestAdminsAreMadeAndUnmade(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	helper := api.register(t, "helper")
	player := api.register(t, "player")
	setRole := func(by *apiUser, id, role string) response {
		return by.form(http.MethodPatch, "/api/v1/users/"+id, url.Values{"role": {role}})
	}

	// The first account is the admin and the library's owner; these others were added as contributors
	var accounts []roleAccount
	owner.expectJSON(http.StatusOK, &accounts, owner.get("/api/v1/users"))
	if accounts[0].Role != "admin" || !accounts[0].IsSuper || accounts[1].Role != "contributor" || accounts[2].Role != "contributor" {
		t.Fatalf("accounts: %+v", accounts)
	}

	// A user can't make themselves an admin; an admin can make them one, and they then manage accounts
	helper.expect(http.StatusForbidden, setRole(helper, helper.id, "admin"))
	owner.expect(http.StatusBadRequest, setRole(owner, helper.id, "boss"))
	owner.expect(http.StatusOK, setRole(owner, helper.id, "admin"))
	helper.expectJSON(http.StatusOK, &accounts, helper.get("/api/v1/users"))
	if accounts[1].Role != "admin" || accounts[1].IsSuper {
		t.Fatalf("accounts: %+v", accounts)
	}
	helper.expect(http.StatusOK, helper.form(http.MethodPost, "/api/v1/users",
		url.Values{"libraryMode": {"1"}, "password": {"password-guest"}, "username": {"guest"}}))

	// The owner keeps their role, library and account, and their password is theirs alone to change
	helper.expect(http.StatusUnprocessableEntity, setRole(helper, owner.id, "user"))
	helper.expect(http.StatusUnprocessableEntity, helper.form(http.MethodPatch, "/api/v1/users/"+owner.id,
		url.Values{"libraryMode": {"1"}}))
	helper.expect(http.StatusUnprocessableEntity, helper.send(http.MethodDelete, "/api/v1/users/"+owner.id, "", nil))
	helper.expect(http.StatusUnprocessableEntity, helper.form(http.MethodPut, "/api/v1/users/"+owner.id+"/password",
		url.Values{"new_password": {"another-password"}}))

	// Shared libraries are still the owner's, whoever else is an admin
	if owned := api.count(t, `SELECT count(*) FROM users WHERE status = 1 AND role = 'admin'`); owned != 2 {
		t.Fatalf("%d admins", owned)
	}

	// Made a player, they're refused once more
	owner.expect(http.StatusOK, setRole(owner, helper.id, "player"))
	helper.expect(http.StatusForbidden, helper.get("/api/v1/users"))
	player.expect(http.StatusForbidden, player.get("/api/v1/users"))
}

func TestAdminRenamesAnAccount(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	player := api.register(t, "player")
	api.register(t, "other")
	rename := func(by *apiUser, id, username string) response {
		return by.form(http.MethodPatch, "/api/v1/users/"+id, url.Values{"username": {username}})
	}

	player.expect(http.StatusForbidden, rename(player, player.id, "champion"))
	admin.expect(http.StatusBadRequest, rename(admin, player.id, "two words"))
	admin.expect(http.StatusConflict, rename(admin, player.id, "Other"))
	admin.expect(http.StatusBadRequest, admin.form(http.MethodPatch, "/api/v1/users/"+player.id, url.Values{}))

	// Only its capitals, then a new name; the owner can be renamed too
	admin.expect(http.StatusOK, rename(admin, player.id, "Player"))
	admin.expect(http.StatusOK, rename(admin, player.id, "champion"))
	admin.expect(http.StatusOK, rename(admin, admin.id, "boss"))

	// They stay signed in, and sign in with the new name and the same password
	player.expect(http.StatusOK, player.get("/api/v1/preference"))
	again := api.browser(t)
	again.expect(http.StatusOK, again.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-player"}, "username": {"champion"}}))
	again.expect(http.StatusUnauthorized, again.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-player"}, "username": {"player"}}))
}

func TestDeletingAnAccountRemovesWhatItKept(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	player := api.register(t, "player")
	other := api.register(t, "other")

	// Each added a game to the library, and has a favorite, a play and settings of their own
	kept := other.addGame("kept.nes")
	gone := player.addGame("gone.nes")
	for user, game := range map[*apiUser]game{other: kept, player: gone} {
		user.expect(http.StatusOK, user.json(http.MethodPost, "/api/v1/favorites", map[string]string{"romId": game.ID}))
		user.expect(http.StatusOK, user.form(http.MethodPost, "/api/v1/launch_records", url.Values{"core": {"fceumm"}, "rom": {game.ID}}))
		user.expect(http.StatusOK, user.json(http.MethodPost, "/api/v1/preference", map[string]any{"ui": map[string]any{"language": "fr"}}))
	}
	left := func(table, userID string) int {
		query := `SELECT count(*) FROM ` + table + ` WHERE user_id = ?`
		if table != "user_preferences" && table != "sessions" {
			query += ` AND status = 1`
		}
		return api.count(t, query, userID)
	}
	for _, table := range []string{"favorites", "launch_records", "user_preferences", "sessions"} {
		if left(table, player.id) == 0 {
			t.Fatalf("the player has nothing in %s to begin with", table)
		}
	}

	admin.expect(http.StatusNotFound, admin.send(http.MethodDelete, "/api/v1/users/nobody", "", nil))
	admin.expect(http.StatusOK, admin.send(http.MethodDelete, "/api/v1/users/"+player.id, "", nil))

	for _, table := range []string{"favorites", "launch_records", "user_preferences", "sessions"} {
		if count := left(table, player.id); count != 0 {
			t.Errorf("the deleted account still has %d in %s", count, table)
		}
		if left(table, other.id) == 0 {
			t.Errorf("another account lost what it had in %s", table)
		}
	}
	player.expect(http.StatusUnauthorized, player.get("/api/v1/preference"))
	// The games they added are the library's, and stay
	other.expect(http.StatusOK, other.get("/api/v1/roms/"+kept.ID+"/content"))
	other.expect(http.StatusOK, other.get("/api/v1/roms/"+gone.ID+"/content"))
	if games := api.count(t, `SELECT count(*) FROM roms WHERE status = 1`); games != 2 {
		t.Fatalf("%d games left in the library", games)
	}

	// The name is free again, and a new account with it starts with nothing of the old one's
	admin.expect(http.StatusOK, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-player"}, "role": {"player"}, "username": {"player"}}))
	again := api.login(t, "player")
	if again.id == player.id || left("favorites", again.id) != 0 {
		t.Fatal("the new account has the deleted one's favorites")
	}
}

func TestSomeoneDeletesTheirOwnAccount(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	player := api.register(t, "player")
	deleteOwn := func(by *apiUser, password string) response {
		return by.form(http.MethodPost, "/api/v1/users/current/delete", url.Values{"password": {password}})
	}

	// Not without their password, and never the owner
	player.expect(http.StatusUnauthorized, deleteOwn(player, "not-my-password"))
	owner.expect(http.StatusUnprocessableEntity, deleteOwn(owner, "password-owner"))
	stranger := api.browser(t)
	stranger.expect(http.StatusUnauthorized, deleteOwn(stranger, "password-player"))

	player.expect(http.StatusOK, deleteOwn(player, "password-player"))
	player.expect(http.StatusUnauthorized, player.get("/api/v1/preference"))
	again := api.browser(t)
	again.expect(http.StatusUnauthorized, again.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-player"}, "username": {"player"}}))
	if api.count(t, `SELECT count(*) FROM users WHERE status = 1`) != 1 {
		t.Fatal("the owner should be the only account left")
	}
}

func TestSignedInDevicesAreListedAndSignedOut(t *testing.T) {
	api := newAPI(t)
	api.register(t, "admin")
	phone := api.register(t, "player")
	laptop := api.login(t, "player")
	tablet := api.login(t, "player")

	type device struct {
		Current bool   `json:"current"`
		ID      string `json:"id"`
	}
	var devices []device
	laptop.expectJSON(http.StatusOK, &devices, laptop.get("/api/v1/sessions"))
	current := 0
	for _, each := range devices {
		if each.Current {
			current++
		}
	}
	if len(devices) != 3 || current != 1 {
		t.Fatalf("devices: %+v", devices)
	}

	// Signed out everywhere else, and only there
	laptop.expect(http.StatusOK, laptop.send(http.MethodDelete, "/api/v1/sessions/others", "", nil))
	laptop.expect(http.StatusOK, laptop.get("/api/v1/preference"))
	phone.expect(http.StatusUnauthorized, phone.get("/api/v1/preference"))
	tablet.expect(http.StatusUnauthorized, tablet.get("/api/v1/preference"))
	laptop.expectJSON(http.StatusOK, &devices, laptop.get("/api/v1/sessions"))
	if len(devices) != 1 || !devices[0].Current {
		t.Fatalf("devices: %+v", devices)
	}
	if api.count(t, `SELECT count(*) FROM sessions WHERE user_id = ?`, laptop.id) != 1 {
		t.Fatal("the other sessions are still kept")
	}
}

func TestSigningInAgainReplacesTheSession(t *testing.T) {
	api := newAPI(t)
	api.register(t, "admin")
	player := api.register(t, "player")
	for range 3 {
		player.expect(http.StatusOK, player.form(http.MethodPost, "/api/v1/auth/login",
			url.Values{"password": {"password-player"}, "username": {"player"}}))
	}
	// One browser, one session, however many times it signed in; another browser has its own
	other := api.login(t, "player")
	if sessions := api.count(t, `SELECT count(*) FROM sessions WHERE user_id = ? AND status = 1`, player.id); sessions != 2 {
		t.Fatalf("%d sessions for 2 browsers", sessions)
	}
	player.expect(http.StatusOK, player.get("/api/v1/preference"))
	other.expect(http.StatusOK, other.get("/api/v1/preference"))
}
