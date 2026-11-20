package web

import (
	"bytes"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestEditGame(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	added := player.addGame("Quest (USA).nes")

	var edited game
	player.expectJSON(http.StatusOK, &edited, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{
		"gameName": {"The Quest"}, "gamePlayers": {"2"}, "gameReleaseDate": {"06/30/1987"},
	}))
	if edited.GameName == nil || *edited.GameName != "The Quest" || edited.GamePlayers == nil || *edited.GamePlayers != 2 ||
		edited.GameReleaseYear == nil || *edited.GameReleaseYear != 1987 {
		t.Fatalf("edited: %+v", edited)
	}

	// A date that can't be read is refused, and "unknown" players are stored as none
	player.expect(http.StatusBadRequest, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID,
		url.Values{"gameReleaseDate": {"someday"}}))
	player.expect(http.StatusBadRequest, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID,
		url.Values{"gameTitle": {strings.Repeat("x", 201)}}))
	player.expectJSON(http.StatusOK, &edited, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID,
		url.Values{"gameName": {"The Quest"}, "gamePlayers": {"unknown"}}))
	if edited.GamePlayers != nil {
		t.Fatalf("players: %v", *edited.GamePlayers)
	}
	player.expect(http.StatusNotFound, player.form(http.MethodPatch, "/api/v1/roms/missing", url.Values{"gameName": {"x"}}))
}

func TestGameImages(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	added := player.addGame("Quest (USA).nes")
	image := map[string]uploadFile{"file": {content: []byte("\x89PNG\r\n\x1a\n"), name: "cover.png"}}

	var boxart string
	player.expectJSON(http.StatusOK, &boxart, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	if !strings.HasPrefix(boxart, "attachments/"+player.id+"/nes/"+added.ID+"/") || !strings.HasSuffix(boxart, ".png") {
		t.Fatalf("box art: %s", boxart)
	}
	// The stored image is the one uploaded, and only its owner can read it
	if body := player.expect(http.StatusOK, player.get("/api/v1/files/"+boxart)); !bytes.Equal(body, image["file"].content) {
		t.Fatalf("stored box art: %q", body)
	}
	other := api.register(t, "other")
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+boxart))
	player.expect(http.StatusBadRequest, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, nil))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	if api.count(t, `SELECT count(*) FROM roms WHERE id = ? AND game_boxart_file_ids IS NULL`, added.ID) != 1 {
		t.Fatal("the box art wasn't removed")
	}

	var first, both, left string
	player.expectJSON(http.StatusOK, &first, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/thumbnail", nil, image))
	player.expectJSON(http.StatusOK, &both, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/thumbnail", nil, image))
	shots := strings.Split(both, ",")
	if len(shots) != 2 || shots[0] != first {
		t.Fatalf("screenshots: %s", both)
	}
	player.expectJSON(http.StatusOK, &left, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/thumbnail/"+shots[0], "", nil))
	if left != shots[1] {
		t.Fatalf("left: %s", left)
	}
	var none *string
	player.expectJSON(http.StatusOK, &none, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/thumbnail/"+shots[1], "", nil))
	if none != nil {
		t.Fatalf("left: %s", *none)
	}
}

func TestDeleteGames(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	games := []game{player.addGame("One.nes"), player.addGame("Two.nes"), player.addGame("Three.nes")}

	player.expect(http.StatusBadRequest, player.send(http.MethodDelete, "/api/v1/roms?ids=", "", nil))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms?ids="+games[0].ID+",+"+games[1].ID, "", nil))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+games[2].ID, "", nil))
	player.expect(http.StatusNotFound, player.send(http.MethodDelete, "/api/v1/roms/"+games[2].ID, "", nil))
	if left := api.count(t, `SELECT count(*) FROM roms WHERE status = 1`); left != 0 {
		t.Fatalf("%d games left", left)
	}
	// Their files go with them, as no other game uses them
	for _, each := range games {
		player.expect(http.StatusNotFound, player.get("/api/v1/files/"+each.FileID))
	}
}

func TestGameFiles(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	added := player.addGame("Quest (USA).nes")

	content := player.expect(http.StatusOK, player.get("/api/v1/roms/"+added.ID+"/content"))
	if string(content) != "NES\x1aQuest (USA).nes" {
		t.Fatalf("content: %q", content)
	}
	player.expect(http.StatusNotFound, player.get("/api/v1/roms/missing/content"))

	var found []struct {
		FileID   string `json:"fileId"`
		FileName string `json:"fileName"`
		Platform string `json:"platform"`
	}
	player.expectJSON(http.StatusOK, &found, player.get("/api/v1/roms/by_files?ids="+url.QueryEscape(added.FileID+",roms/nes/none.nes")))
	if len(found) != 1 || found[0].FileID != added.FileID || found[0].FileName != added.FileName || found[0].Platform != "nes" {
		t.Fatalf("found: %+v", found)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/roms/by_files"))

	// The same file uploaded again is the same game, not a second one
	again := player.addGame("Quest (USA).nes")
	if again.FileID != added.FileID || again.ID != added.ID || api.count(t, `SELECT count(*) FROM roms`) != 1 {
		t.Fatalf("again: %+v, first: %+v", again, added)
	}
	player.expect(http.StatusUnprocessableEntity, player.multipart(http.MethodPost, "/api/v1/roms",
		map[string]string{"platform": "nes"}, map[string]uploadFile{"file": {content: []byte("x"), name: "Quest.txt"}}))
}

// Another player's games are out of reach: not found, as if they weren't there
func TestGamesOfOthers(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	other := api.register(t, "other")
	added := owner.addGame("Quest (USA).nes")
	image := map[string]uploadFile{"file": {content: []byte("image"), name: "cover.png"}}

	other.expect(http.StatusNotFound, other.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameName": {"Mine"}}))
	other.expect(http.StatusNotFound, other.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	other.expect(http.StatusNotFound, other.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/thumbnail", nil, image))
	other.expect(http.StatusNotFound, other.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	other.expect(http.StatusNotFound, other.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/thumbnail/x", "", nil))
	other.expect(http.StatusNotFound, other.get("/api/v1/roms/"+added.ID+"/content"))
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+added.FileID))
	other.expect(http.StatusNotFound, other.send(http.MethodDelete, "/api/v1/roms/"+added.ID, "", nil))
	other.expect(http.StatusOK, other.send(http.MethodDelete, "/api/v1/roms?ids="+added.ID, "", nil))

	var found []any
	other.expectJSON(http.StatusOK, &found, other.get("/api/v1/roms/by_files?ids="+url.QueryEscape(added.FileID)))
	if len(found) != 0 {
		t.Fatalf("found: %v", found)
	}
	if api.count(t, `SELECT count(*) FROM roms WHERE id = ? AND status = 1 AND game_name IS NOT 'Mine'`, added.ID) != 1 {
		t.Fatal("another player changed or deleted the game")
	}
	owner.expect(http.StatusOK, owner.get("/api/v1/roms/"+added.ID+"/content"))
}

// An account that shares the admin's library sees the admin's games, and can't change them
func TestSharedLibraryIsReadOnly(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	added := admin.addGame("Quest (USA).nes")
	admin.expect(http.StatusOK, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"libraryMode": {"1"}, "password": {"password-guest"}, "username": {"guest"}}))
	guest := api.login(t, "guest")

	if content := guest.expect(http.StatusOK, guest.get("/api/v1/roms/"+added.ID+"/content")); len(content) == 0 {
		t.Fatal("the guest can't play the admin's game")
	}
	guest.expect(http.StatusOK, guest.get("/api/v1/files/"+added.FileID))
	image := map[string]uploadFile{"file": {content: []byte("image"), name: "cover.png"}}
	guest.expect(http.StatusForbidden, guest.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameName": {"Mine"}}))
	guest.expect(http.StatusForbidden, guest.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	guest.expect(http.StatusForbidden, guest.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/thumbnail/x", "", nil))
	guest.expect(http.StatusForbidden, guest.send(http.MethodDelete, "/api/v1/roms/"+added.ID, "", nil))
	guest.expect(http.StatusForbidden, guest.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nes"},
		map[string]uploadFile{"file": {content: []byte("NES"), name: "Other.nes"}}))
	if api.count(t, `SELECT count(*) FROM roms WHERE status = 1`) != 1 {
		t.Fatal("the guest changed the admin's library")
	}
}
