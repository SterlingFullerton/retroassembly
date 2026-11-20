package web

import (
	"bytes"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type settings struct {
	Emulator struct {
		Platform map[string]struct {
			Bioses []struct {
				FileID   string `json:"fileId"`
				FileName string `json:"fileName"`
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
