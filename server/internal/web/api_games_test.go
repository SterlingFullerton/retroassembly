package web

import (
	"bytes"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"retroassembly/server/internal/files"
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
	// The stored image is the one uploaded, and anyone signed in can read it, as they can the game
	if body := player.expect(http.StatusOK, player.get("/api/v1/files/"+boxart)); !bytes.Equal(body, image["file"].content) {
		t.Fatalf("stored box art: %q", body)
	}
	other := api.register(t, "other")
	other.expect(http.StatusOK, other.get("/api/v1/files/"+boxart))
	stranger := api.browser(t)
	stranger.expect(http.StatusUnauthorized, stranger.get("/api/v1/files/"+boxart))
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

// The library is everyone's to play. Contributors add games and edit them; only admins delete them; players do neither
func TestRolesInTheLibrary(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	contributor := api.register(t, "contributor")
	admin.expect(http.StatusOK, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-player"}, "role": {"player"}, "username": {"player"}}))
	player := api.login(t, "player")
	added := admin.addGame("Quest (USA).nes")
	image := map[string]uploadFile{"file": {content: []byte("image"), name: "cover.png"}}
	upload := func(user *apiUser, fileName string) response {
		return user.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nes"},
			map[string]uploadFile{"file": {content: []byte("NES\x1a" + fileName), name: fileName}})
	}

	// Everyone sees and plays the same games
	for _, user := range []*apiUser{admin, contributor, player} {
		user.expect(http.StatusOK, user.get("/api/v1/roms/"+added.ID+"/content"))
		user.expect(http.StatusOK, user.get("/api/v1/files/"+added.FileID))
		var found []any
		user.expectJSON(http.StatusOK, &found, user.get("/api/v1/roms/by_files?ids="+url.QueryEscape(added.FileID)))
		if len(found) != 1 {
			t.Fatalf("found: %v", found)
		}
	}

	// A player changes nothing
	player.expect(http.StatusForbidden, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameName": {"Mine"}}))
	player.expect(http.StatusForbidden, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	player.expect(http.StatusForbidden, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/thumbnail", nil, image))
	player.expect(http.StatusForbidden, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	player.expect(http.StatusForbidden, upload(player, "Mine.nes"))
	player.expect(http.StatusForbidden, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID, "", nil))
	player.expect(http.StatusForbidden, player.send(http.MethodDelete, "/api/v1/roms?ids="+added.ID, "", nil))

	// A contributor adds to the library and edits what's in it, whoever added it, but deletes nothing
	var theirs game
	contributor.expectJSON(http.StatusOK, &theirs, upload(contributor, "Theirs.nes"))
	contributor.expect(http.StatusOK, contributor.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameName": {"Renamed"}}))
	contributor.expect(http.StatusOK, contributor.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	contributor.expect(http.StatusForbidden, contributor.send(http.MethodDelete, "/api/v1/roms/"+added.ID, "", nil))
	contributor.expect(http.StatusForbidden, contributor.send(http.MethodDelete, "/api/v1/roms?ids="+theirs.ID, "", nil))
	if api.count(t, `SELECT count(*) FROM roms WHERE status = 1 AND user_id = ?`, admin.id) != 2 {
		t.Fatal("the library should have both games, kept under its owner")
	}
	if api.count(t, `SELECT count(*) FROM roms WHERE id = ? AND game_name = 'Renamed'`, added.ID) != 1 {
		t.Fatal("the contributor's edit wasn't saved")
	}
	// What a contributor added, everyone plays
	player.expect(http.StatusOK, player.get("/api/v1/roms/"+theirs.ID+"/content"))

	// An admin deletes, for everyone
	admin.expect(http.StatusOK, admin.send(http.MethodDelete, "/api/v1/roms/"+theirs.ID, "", nil))
	player.expect(http.StatusNotFound, player.get("/api/v1/roms/"+theirs.ID+"/content"))
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

// Pictures a game no longer shows, and a deleted game's, are removed from disk; a picture id pointed elsewhere isn't
func TestUnusedPicturesAreRemoved(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	added := player.addGame("Quest (USA).nes")
	image := map[string]uploadFile{"file": {content: []byte("image"), name: "cover.png"}}
	exists := func(user *apiUser, fileID string) bool {
		return user.get("/api/v1/files/"+fileID).status == http.StatusOK
	}

	var first, second string
	player.expectJSON(http.StatusOK, &first, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	player.expectJSON(http.StatusOK, &second, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	if exists(player, first) || !exists(player, second) {
		t.Fatal("replaced box art kept, or the new one missing")
	}
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	if exists(player, second) {
		t.Fatal("removed box art kept")
	}

	var shots string
	player.expectJSON(http.StatusOK, &shots, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/thumbnail", nil, image))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/thumbnail/"+shots, "", nil))
	if exists(player, shots) {
		t.Fatal("removed screenshot kept")
	}

	// Box art pointed at another player's picture, then removed, leaves their picture alone
	theirs := other.addGame("Theirs.nes")
	var theirBoxart string
	other.expectJSON(http.StatusOK, &theirBoxart, other.multipart(http.MethodPost, "/api/v1/roms/"+theirs.ID+"/boxart", nil, image))
	player.expect(http.StatusOK, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameBoxartFileIds": {theirBoxart}}))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	if !exists(other, theirBoxart) {
		t.Fatal("another player's picture was deleted")
	}

	// Nor does one that starts in the player's own game's folder and climbs out of it to theirs
	climbing := "attachments/" + player.id + "/nes/" + added.ID + "/../../../../" + theirBoxart
	player.expect(http.StatusOK, player.form(http.MethodPatch, "/api/v1/roms/"+added.ID, url.Values{"gameBoxartFileIds": {climbing}}))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID+"/boxart", "", nil))
	if !exists(other, theirBoxart) {
		t.Fatal("another player's picture was deleted through a climbing path")
	}

	// A deleted game's pictures go with it
	player.expectJSON(http.StatusOK, &first, player.multipart(http.MethodPost, "/api/v1/roms/"+added.ID+"/boxart", nil, image))
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+added.ID, "", nil))
	folder := filepath.Join(api.config.Directories.Attachments, player.id, "nes", added.ID)
	if _, err := os.Stat(folder); !os.IsNotExist(err) {
		t.Fatalf("the deleted game's pictures are still there: %v", err)
	}
}

// A game uploaded again under its name with other content no longer keeps its old file
func TestReuploadRemovesTheOldFile(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	var first, second game
	player.expectJSON(http.StatusOK, &first, player.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nes"},
		map[string]uploadFile{"file": {content: []byte("NES\x1afirst"), name: "Quest.nes"}}))
	player.expectJSON(http.StatusOK, &second, player.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nes"},
		map[string]uploadFile{"file": {content: []byte("NES\x1asecond"), name: "Quest.nes"}}))
	if first.FileID == second.FileID || first.ID != second.ID {
		t.Fatalf("first %+v, second %+v", first, second)
	}
	if path, _ := api.config.FilePath(first.FileID); files.Exists(path) {
		t.Fatal("the old file is kept")
	}
	if path, _ := api.config.FilePath(second.FileID); !files.Exists(path) {
		t.Fatal("the new file is missing")
	}
}
