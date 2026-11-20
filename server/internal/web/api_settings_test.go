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
	// Only those whose settings have it may read it
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+bioses[0].FileID))

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

	// The other player's BIOS files are untouched by any of it
	other.expectJSON(http.StatusOK, &saved, other.get("/api/v1/preference"))
	if len(saved.Emulator.Platform["nes"].Bioses) != 0 {
		t.Fatalf("the other player's: %+v", saved.Emulator.Platform["nes"].Bioses)
	}
}

// A player who shares the admin's library uses the admin's BIOS files, on each console they haven't added any for. One
// with a library of their own doesn't
func TestSharedLibraryBIOSFiles(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	admin.expect(http.StatusOK, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"libraryMode": {"1"}, "password": {"password-friend"}, "username": {"friend"}}))
	friend := api.login(t, "friend")
	separate := api.register(t, "separate")
	add := func(user *apiUser, platform, name string) {
		user.expect(http.StatusOK, user.multipart(http.MethodPost, "/api/v1/preference/bioses",
			map[string]string{"platform": platform}, map[string]uploadFile{"file": {content: []byte(name), name: name}}))
	}
	for _, name := range []string{"sl31253.bin", "sl31254.bin", "sl90025.bin"} {
		add(admin, "channelf", name)
	}
	add(admin, "nes", "disksys.rom")
	add(friend, "nes", "mine.rom")

	var adminSettings, friendSettings, separateSettings settings
	admin.expectJSON(http.StatusOK, &adminSettings, admin.get("/api/v1/preference"))
	friend.expectJSON(http.StatusOK, &friendSettings, friend.get("/api/v1/preference"))
	channelF := friendSettings.Emulator.Platform["channelf"].Bioses
	if len(channelF) != 3 || channelF[0].FileID != adminSettings.Emulator.Platform["channelf"].Bioses[0].FileID {
		t.Fatalf("the friend's Channel F BIOS files: %+v", channelF)
	}
	for _, bios := range channelF {
		if body := friend.expect(http.StatusOK, friend.get("/api/v1/files/"+bios.FileID)); string(body) != bios.FileName {
			t.Fatalf("%s: %q", bios.FileName, body)
		}
		if !bios.Shared {
			t.Fatalf("%s isn't marked as the admin's", bios.FileName)
		}
	}
	if adminSettings.Emulator.Platform["channelf"].Bioses[0].Shared {
		t.Fatal("the admin's own BIOS files are marked shared")
	}
	// Sent back with other settings, the admin's aren't saved as the friend's
	friend.expect(http.StatusOK, friend.json(http.MethodPost, "/api/v1/preference", map[string]any{"emulator": map[string]any{
		"platform": map[string]any{"channelf": map[string]any{"bioses": channelF, "rewindEnabled": false}},
	}}))
	if api.count(t, `SELECT count(*) FROM user_preferences WHERE user_id = ? AND emulator LIKE '%sl31253%'`, friend.id) != 0 {
		t.Fatal("the admin's BIOS files were saved in the friend's settings")
	}
	// Their own BIOS files for a console are used in place of the admin's
	if nes := friendSettings.Emulator.Platform["nes"].Bioses; len(nes) != 1 || nes[0].FileName != "mine.rom" {
		t.Fatalf("the friend's NES BIOS files: %+v", nes)
	}

	separate.expectJSON(http.StatusOK, &separateSettings, separate.get("/api/v1/preference"))
	if bioses := separateSettings.Emulator.Platform["channelf"].Bioses; len(bioses) != 0 {
		t.Fatalf("a player with their own library got the admin's: %+v", bioses)
	}
	separate.expect(http.StatusNotFound, separate.get("/api/v1/files/"+channelF[0].FileID))

	// Once the admin stops sharing their library with the friend, the admin's BIOS files go with it
	admin.expect(http.StatusOK, admin.form(http.MethodPatch, "/api/v1/users/"+friend.id, url.Values{"libraryMode": {"0"}}))
	friend.expectJSON(http.StatusOK, &friendSettings, friend.get("/api/v1/preference"))
	if bioses := friendSettings.Emulator.Platform["channelf"].Bioses; len(bioses) != 0 {
		t.Fatalf("after the library was no longer shared: %+v", bioses)
	}
	friend.expect(http.StatusNotFound, friend.get("/api/v1/files/"+channelF[0].FileID))
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

// Whoever has a BIOS file in their settings may download it, so a file id copied into one's settings is left out
func TestBIOSFileIDsCantBeCopiedIn(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	other := api.register(t, "other")
	var saved settings
	owner.expectJSON(http.StatusOK, &saved, owner.multipart(http.MethodPost, "/api/v1/preference/bioses",
		map[string]string{"platform": "psx"}, map[string]uploadFile{"file": {content: []byte("a BIOS"), name: "scph5501.bin"}}))
	id := saved.Emulator.Platform["psx"].Bioses[0].FileID

	other.expectJSON(http.StatusOK, &saved, other.json(http.MethodPost, "/api/v1/preference", map[string]any{"emulator": map[string]any{
		"platform": map[string]any{"psx": map[string]any{"bioses": []any{map[string]any{"fileId": id, "fileName": "scph5501.bin"}}}},
	}}))
	if len(saved.Emulator.Platform["psx"].Bioses) != 0 {
		t.Fatalf("copied in: %+v", saved.Emulator.Platform["psx"].Bioses)
	}
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+id))

	// The owner's own settings, saved with their BIOS files in them, keep them
	owner.expectJSON(http.StatusOK, &saved, owner.json(http.MethodPost, "/api/v1/preference", map[string]any{"emulator": map[string]any{
		"platform": map[string]any{"psx": map[string]any{"bioses": []any{map[string]any{"fileId": id, "fileName": "scph5501.bin"}}}},
	}}))
	if len(saved.Emulator.Platform["psx"].Bioses) != 1 {
		t.Fatalf("the owner's own: %+v", saved.Emulator.Platform["psx"].Bioses)
	}
}

// A BIOS file goes once it's in no one's settings, and stays while it's in anyone's
func TestUnusedBIOSFilesAreRemoved(t *testing.T) {
	api := newAPI(t)
	first := api.register(t, "first")
	second := api.register(t, "second")
	add := func(user *apiUser, content string) string {
		var saved settings
		user.expectJSON(http.StatusOK, &saved, user.multipart(http.MethodPost, "/api/v1/preference/bioses",
			map[string]string{"platform": "nes"}, map[string]uploadFile{"file": {content: []byte(content), name: "disksys.rom"}}))
		return saved.Emulator.Platform["nes"].Bioses[0].FileID
	}
	onDisk := func(fileID string) bool {
		path, _ := api.config.FilePath(fileID)
		return files.Exists(path)
	}
	shared := add(first, "a BIOS")
	if add(second, "a BIOS") != shared {
		t.Fatal("the same content stored twice")
	}
	first.expect(http.StatusOK, first.send(http.MethodDelete, "/api/v1/preference/bioses?platform=nes&file_name=disksys.rom", "", nil))
	if !onDisk(shared) {
		t.Fatal("removed while another player has it")
	}
	// Replaced by other content, it's in no one's settings
	newer := add(second, "a newer BIOS")
	if onDisk(shared) || !onDisk(newer) {
		t.Fatal("the replaced file is kept, or the new one missing")
	}
	second.expect(http.StatusOK, second.send(http.MethodDelete, "/api/v1/preference/bioses?platform=nes&file_name=disksys.rom", "", nil))
	if onDisk(newer) {
		t.Fatal("kept once no one has it")
	}
}
