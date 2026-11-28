package web

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"retroassembly/server/internal/files"
)

// An account's settings can name any file with bioses/../ in front of its id. Deleting the account, by its owner or by
// an admin, removes only BIOS files: never a game, another BIOS file or anyone else's file
func TestDeletingAnAccountDeletesNoFilesItNamesInItsSettings(t *testing.T) {
	t.Setenv("OPEN_SIGNUP", "true")
	api := newAPI(t)
	admin := api.register(t, "admin")
	game := admin.addGame("Quest (USA).nes")
	var withBIOS settings
	admin.expectJSON(http.StatusOK, &withBIOS, admin.multipart(http.MethodPost, "/api/v1/preference/bioses",
		map[string]string{"platform": "nes"}, map[string]uploadFile{"file": {content: []byte("a BIOS"), name: "disksys.rom"}}))
	bios := withBIOS.Emulator.Platform["nes"].Bioses[0].FileID
	onDisk := func(fileID string) bool {
		filePath, ok := api.config.FilePath(fileID)
		return ok && files.Exists(filePath)
	}
	if !onDisk(game.FileID) || !onDisk(bios) {
		t.Fatal("the game or the BIOS file isn't stored to begin with")
	}
	targets := []any{"bioses/../" + game.FileID, "bioses/nes/../../" + game.FileID, "bioses/./../" + bios, bios}

	signUp := func(name string) *apiUser {
		user := api.browser(t)
		user.expect(http.StatusOK, user.form(http.MethodPost, "/api/v1/auth/register",
			url.Values{"password": {"password-" + name}, "username": {name}}))
		return api.login(t, name)
	}
	// One sends the ids as settings; the other has them stored from before settings were checked
	sender, stored := signUp("sender"), signUp("stored")
	sender.expect(http.StatusOK, sender.json(http.MethodPost, "/api/v1/preference", map[string]any{"emulator": map[string]any{
		"x": targets,
		"platform": map[string]any{"nes": map[string]any{
			"bioses": []any{map[string]any{"fileId": targets[0], "fileName": "disksys.rom"}}, "shader": targets[1],
		}},
	}}))
	if count := api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ? AND emulator LIKE '%"x"%'`, sender.id); count != 0 {
		t.Fatal("a setting the app doesn't have was kept")
	}
	stored.expect(http.StatusOK, stored.json(http.MethodPost, "/api/v1/preference", map[string]any{"ui": map[string]any{"language": "fr"}}))
	emulator := `{"x":["bioses/../` + game.FileID + `"],"platform":{"nes":{"bioses":[` +
		`{"fileId":"bioses/../` + game.FileID + `","fileName":"a"},{"fileId":"bioses/./../` + bios + `","fileName":"b"}]}}}`
	if _, err := api.database.Exec(`UPDATE user_preferences SET emulator = ? WHERE user_id = ?`, emulator, stored.id); err != nil {
		t.Fatal(err)
	}

	sender.expect(http.StatusOK, sender.form(http.MethodPost, "/api/v1/users/current/delete",
		url.Values{"password": {"password-sender"}}))
	admin.expect(http.StatusOK, admin.send(http.MethodDelete, "/api/v1/users/"+stored.id, "", nil))

	if !onDisk(game.FileID) || !onDisk(bios) {
		t.Fatal("deleting an account deleted a file its settings named")
	}
	admin.expect(http.StatusOK, admin.get("/api/v1/roms/"+game.ID+"/content"))

	// Only a BIOS file's own id, as it's stored, is ever removed
	api.server.removeUnusedBioses(context.Background(), []string{"bioses/../" + game.FileID, "bioses/nes/../../" + game.FileID, "roms/../" + game.FileID})
	if !onDisk(game.FileID) {
		t.Fatal("removing unused BIOS files deleted a game")
	}
}
