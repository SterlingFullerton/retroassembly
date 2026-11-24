package web

import (
	"bytes"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"retroassembly/server/internal/files"
)

type settings struct {
	Emulator struct {
		Platform map[string]struct {
			Bioses []struct {
				FileID   string `json:"fileId"`
				FileName string `json:"fileName"`
				Shared   bool   `json:"shared"`
			} `json:"bioses"`
			Core string `json:"core"`
		} `json:"platform"`
	} `json:"emulator"`
	UI struct {
		DateFormat string `json:"dateFormat"`
		ShowTitle  bool   `json:"showTitle"`
	} `json:"ui"`
}

func TestSettings(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")

	var current settings
	player.expectJSON(http.StatusOK, &current, player.get("/api/v1/preference"))
	if current.UI.DateFormat != "auto" || !current.UI.ShowTitle || current.Emulator.Platform["nes"].Core != "fceumm" {
		t.Fatalf("defaults: %+v", current)
	}

	// The first change adds the player's settings, and later ones are merged into them
	player.expectJSON(http.StatusOK, &current, player.json(http.MethodPost, "/api/v1/preference",
		map[string]any{"ui": map[string]any{"dateFormat": "dd/MM/yyyy"}}))
	if current.UI.DateFormat != "dd/MM/yyyy" {
		t.Fatalf("saved: %+v", current)
	}
	player.expectJSON(http.StatusOK, &current, player.json(http.MethodPost, "/api/v1/preference",
		map[string]any{"ui": map[string]any{"showTitle": false}}))
	if current.UI.DateFormat != "dd/MM/yyyy" || current.UI.ShowTitle {
		t.Fatalf("merged: %+v", current)
	}
	player.expectJSON(http.StatusOK, &current, player.get("/api/v1/preference"))
	if current.UI.DateFormat != "dd/MM/yyyy" || current.UI.ShowTitle {
		t.Fatalf("read back: %+v", current)
	}
	player.expect(http.StatusBadRequest, player.send(http.MethodPost, "/api/v1/preference", "application/json",
		strings.NewReader("{")))

	// The player's date format is the one a release date is typed in
	added := player.addGame("Quest (USA).nes")
	var edited game
	player.expectJSON(http.StatusOK, &edited, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID,
		url.Values{"gameReleaseDate": {"30/06/1987"}}))
	if edited.GameReleaseYear == nil || *edited.GameReleaseYear != 1987 {
		t.Fatalf("edited: %+v", edited)
	}

	// Another player's settings are their own
	other.expectJSON(http.StatusOK, &current, other.get("/api/v1/preference"))
	if current.UI.DateFormat != "auto" || !current.UI.ShowTitle {
		t.Fatalf("the other player's settings: %+v", current)
	}
}

func TestBIOSFiles(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	bios := []byte("a BIOS")
	add := func(user *apiUser, name string, content []byte) settings {
		var saved settings
		user.expectJSON(http.StatusOK, &saved, user.multipart(http.MethodPost, "/api/v1/preference/bioses",
			map[string]string{"platform": "nes"}, map[string]uploadFile{"file": {content: content, name: name}}))
		return saved
	}

	saved := add(player, "disksys.rom", bios)
	bioses := saved.Emulator.Platform["nes"].Bioses
	if len(bioses) != 1 || bioses[0].FileName != "disksys.rom" || !strings.HasPrefix(bioses[0].FileID, "bioses/nes/") {
		t.Fatalf("bioses: %+v", bioses)
	}
	if body := player.expect(http.StatusOK, player.get("/api/v1/files/"+bioses[0].FileID)); !bytes.Equal(body, bios) {
		t.Fatalf("stored: %q", body)
	}
	// The owner's BIOS files are everyone's to play with; a stranger's no one's
	other.expect(http.StatusOK, other.get("/api/v1/files/"+bioses[0].FileID))
	stranger := api.browser(t)
	stranger.expect(http.StatusUnauthorized, stranger.get("/api/v1/files/"+bioses[0].FileID))

	// One of the same name takes the place of the first
	saved = add(player, "disksys.rom", []byte("a newer BIOS"))
	if replaced := saved.Emulator.Platform["nes"].Bioses; len(replaced) != 1 || replaced[0].FileID == bioses[0].FileID {
		t.Fatalf("replaced: %+v", replaced)
	}
	add(player, "other.rom", bios)

	player.expect(http.StatusBadRequest, player.multipart(http.MethodPost, "/api/v1/preference/bioses",
		map[string]string{"platform": "nes"}, nil))
	player.expect(http.StatusBadRequest, player.send(http.MethodDelete, "/api/v1/preference/bioses?platform=nes", "", nil))
	player.expectJSON(http.StatusOK, &saved, player.send(http.MethodDelete,
		"/api/v1/preference/bioses?platform=nes&file_name=disksys.rom", "", nil))
	if left := saved.Emulator.Platform["nes"].Bioses; len(left) != 1 || left[0].FileName != "other.rom" {
		t.Fatalf("left: %+v", left)
	}

	// The other player has what the owner has left, as the owner's and not their own
	other.expectJSON(http.StatusOK, &saved, other.get("/api/v1/preference"))
	if left := saved.Emulator.Platform["nes"].Bioses; len(left) != 1 || left[0].FileName != "other.rom" || !left[0].Shared {
		t.Fatalf("the other player's: %+v", left)
	}
	if api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ?`, other.id) != 0 {
		t.Fatal("the other player's settings were written to")
	}
}

// The server has one set of BIOS files, which everyone plays with and only admins change
func TestServerBIOSFiles(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	contributor := api.register(t, "contributor")
	second := api.register(t, "second")
	owner.expect(http.StatusOK, owner.form(http.MethodPatch, "/api/v1/users/"+second.id, url.Values{"role": {"admin"}}))
	owner.expect(http.StatusOK, owner.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-friend"}, "role": {"player"}, "username": {"friend"}}))
	friend := api.login(t, "friend")
	add := func(user *apiUser, platform, name string) response {
		return user.multipart(http.MethodPost, "/api/v1/preference/bioses",
			map[string]string{"platform": platform}, map[string]uploadFile{"file": {content: []byte(name), name: name}})
	}
	remove := func(user *apiUser, platform, name string) response {
		return user.send(http.MethodDelete, "/api/v1/preference/bioses?platform="+platform+"&file_name="+name, "", nil)
	}
	for _, name := range []string{"sl31253.bin", "sl31254.bin", "sl90025.bin"} {
		owner.expect(http.StatusOK, add(owner, "channelf", name))
	}

	// Everyone has them, and can read them; only admins see them as theirs to remove
	var ownerSettings settings
	owner.expectJSON(http.StatusOK, &ownerSettings, owner.get("/api/v1/preference"))
	first := ownerSettings.Emulator.Platform["channelf"].Bioses[0].FileID
	for user, manages := range map[*apiUser]bool{owner: true, second: true, contributor: false, friend: false} {
		var seen settings
		user.expectJSON(http.StatusOK, &seen, user.get("/api/v1/preference"))
		bioses := seen.Emulator.Platform["channelf"].Bioses
		if len(bioses) != 3 || bioses[0].FileID != first {
			t.Fatalf("Channel F BIOS files: %+v", bioses)
		}
		for _, bios := range bioses {
			if bios.Shared == manages {
				t.Fatalf("%s marked shared %v for someone who manages them: %v", bios.FileName, bios.Shared, manages)
			}
			if body := user.expect(http.StatusOK, user.get("/api/v1/files/"+bios.FileID)); string(body) != bios.FileName {
				t.Fatalf("%s: %q", bios.FileName, body)
			}
		}
	}

	// Players and contributors change nothing
	for _, user := range []*apiUser{contributor, friend} {
		user.expect(http.StatusForbidden, add(user, "nes", "disksys.rom"))
		user.expect(http.StatusForbidden, remove(user, "channelf", "sl31253.bin"))
		// Sent back with other settings, the server's aren't saved as their own
		var seen settings
		user.expectJSON(http.StatusOK, &seen, user.get("/api/v1/preference"))
		user.expect(http.StatusOK, user.json(http.MethodPost, "/api/v1/preference", map[string]any{"emulator": map[string]any{
			"platform": map[string]any{"channelf": map[string]any{"bioses": seen.Emulator.Platform["channelf"].Bioses, "rewindEnabled": false}},
		}}))
		if api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ? AND emulator LIKE '%sl31253%'`, user.id) != 0 {
			t.Fatal("the server's BIOS files were saved in someone's own settings")
		}
	}

	// Another admin adds to the same set and removes from it, and it's kept in the owner's settings
	var after settings
	second.expectJSON(http.StatusOK, &after, add(second, "nes", "disksys.rom"))
	if nes := after.Emulator.Platform["nes"].Bioses; len(nes) != 1 || nes[0].Shared {
		t.Fatalf("NES BIOS files as the second admin sees them: %+v", nes)
	}
	second.expectJSON(http.StatusOK, &after, remove(second, "channelf", "sl31253.bin"))
	if left := after.Emulator.Platform["channelf"].Bioses; len(left) != 2 {
		t.Fatalf("Channel F BIOS files left: %+v", left)
	}
	if api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ? AND emulator LIKE '%disksys%'`, owner.id) != 1 ||
		api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ? AND emulator LIKE '%bioses/%'`, second.id) != 0 {
		t.Fatal("the second admin's changes aren't in the owner's settings alone")
	}
	var seen settings
	friend.expectJSON(http.StatusOK, &seen, friend.get("/api/v1/preference"))
	if len(seen.Emulator.Platform["channelf"].Bioses) != 2 || len(seen.Emulator.Platform["nes"].Bioses) != 1 {
		t.Fatalf("what the friend has now: %+v", seen.Emulator.Platform)
	}
	friend.expect(http.StatusNotFound, friend.get("/api/v1/files/"+first))
}

// A console's name is part of a BIOS file's path, so only the app's consoles are taken, in settings and for BIOS files
func TestBIOSFilesOnlyForKnownConsoles(t *testing.T) {
	api := newAPI(t)
	user := api.register(t, "user")
	user.expect(http.StatusOK, user.json(http.MethodPost, "/api/v1/preference",
		map[string]any{"emulator": map[string]any{"platform": map[string]any{"../roms/psp": map[string]any{}}}}))
	if api.count(t, `SELECT count(*) FROM user_preferences WHERE emulator LIKE '%../roms%'`) != 0 {
		t.Fatal("an unknown console was saved in the settings")
	}
	user.expect(http.StatusBadRequest, user.multipart(http.MethodPost, "/api/v1/preference/bioses",
		map[string]string{"platform": "../roms/psp"}, map[string]uploadFile{"file": {content: []byte("CISO"), name: "x.cso"}}))
	user.expect(http.StatusBadRequest, user.send(http.MethodDelete, "/api/v1/preference/bioses?platform=../roms&file_name=x", "", nil))
	if matches, _ := filepath.Glob(filepath.Join(api.config.Directories.Roms, "psp", "*")); len(matches) != 0 {
		t.Fatalf("written among the games: %v", matches)
	}
}

// BIOS files are only ever added by uploading one: a file id written into settings is left out, the server's as well
// as one's own, so it can't name some other stored file to download
func TestBIOSFileIDsCantBeCopiedIn(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	other := api.register(t, "other")
	var saved settings
	admin.expectJSON(http.StatusOK, &saved, admin.multipart(http.MethodPost, "/api/v1/preference/bioses",
		map[string]string{"platform": "psx"}, map[string]uploadFile{"file": {content: []byte("a BIOS"), name: "scph5501.bin"}}))
	id := saved.Emulator.Platform["psx"].Bioses[0].FileID
	copied := map[string]any{"emulator": map[string]any{
		"platform": map[string]any{"nes": map[string]any{"bioses": []any{map[string]any{"fileId": id, "fileName": "disksys.rom"}}}},
	}}

	for _, user := range []*apiUser{other, admin} {
		user.expectJSON(http.StatusOK, &saved, user.json(http.MethodPost, "/api/v1/preference", copied))
		if len(saved.Emulator.Platform["nes"].Bioses) != 0 || len(saved.Emulator.Platform["psx"].Bioses) != 1 {
			t.Fatalf("copied in: %+v", saved.Emulator.Platform)
		}
	}
	if api.count(t, `SELECT count(*) FROM user_preferences WHERE emulator LIKE '%disksys%'`) != 0 {
		t.Fatal("a copied file id was saved")
	}
}

// A BIOS file goes once it's no longer among the server's
func TestUnusedBIOSFilesAreRemoved(t *testing.T) {
	api := newAPI(t)
	first := api.register(t, "first")
	second := api.register(t, "second")
	first.expect(http.StatusOK, first.form(http.MethodPatch, "/api/v1/users/"+second.id, url.Values{"role": {"admin"}}))
	add := func(user *apiUser, content string) string {
		var saved settings
		user.expectJSON(http.StatusOK, &saved, user.multipart(http.MethodPost, "/api/v1/preference/bioses",
			map[string]string{"platform": "nes"}, map[string]uploadFile{"file": {content: []byte(content), name: "disksys.rom"}}))
		if len(saved.Emulator.Platform["nes"].Bioses) != 1 {
			t.Fatalf("NES BIOS files: %+v", saved.Emulator.Platform["nes"].Bioses)
		}
		return saved.Emulator.Platform["nes"].Bioses[0].FileID
	}
	onDisk := func(fileID string) bool {
		path, _ := api.config.FilePath(fileID)
		return files.Exists(path)
	}
	stored := add(first, "a BIOS")
	if add(second, "a BIOS") != stored || !onDisk(stored) {
		t.Fatal("the same content stored twice, or not at all")
	}
	// Replaced by other content, it's no longer the server's
	newer := add(second, "a newer BIOS")
	if onDisk(stored) || !onDisk(newer) {
		t.Fatal("the replaced file is kept, or the new one missing")
	}
	first.expect(http.StatusOK, first.send(http.MethodDelete, "/api/v1/preference/bioses?platform=nes&file_name=disksys.rom", "", nil))
	if onDisk(newer) {
		t.Fatal("kept once removed")
	}
}
