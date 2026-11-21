package web

import (
	"bytes"
	"net/http"
	"testing"
)

type saveState struct {
	FileID          string  `json:"fileId"`
	ID              string  `json:"id"`
	RomID           string  `json:"romId"`
	ThumbnailFileID string  `json:"thumbnailFileId"`
	Type            string  `json:"type"`
	ClientID        *string `json:"clientId"`
}

func (u *apiUser) saveState(romID, stateType, clientID string) response {
	fields := map[string]string{"core": "fceumm", "rom": romID, "type": stateType}
	if clientID != "" {
		fields["clientId"] = clientID
	}
	return u.multipart(http.MethodPost, "/api/v1/states", fields, map[string]uploadFile{
		"state": {content: []byte("state of " + romID), name: "blob"}, "thumbnail": {content: []byte("thumbnail"), name: "blob"},
	})
}

func TestSaveStates(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	added := player.addGame("Quest (USA).nes")

	var manual, auto, again saveState
	player.expectJSON(http.StatusOK, &manual, player.saveState(added.ID, "manual", "client-1"))
	player.expectJSON(http.StatusOK, &auto, player.saveState(added.ID, "auto", ""))
	// Sent again with the same client id, as after a dropped connection, it's the same save
	player.expectJSON(http.StatusOK, &again, player.saveState(added.ID, "manual", "client-1"))
	if again.ID != manual.ID {
		t.Fatalf("sent again: %s, first: %s", again.ID, manual.ID)
	}
	player.expect(http.StatusBadRequest, player.saveState(added.ID, "sometimes", ""))
	player.expect(http.StatusNotFound, player.saveState("missing", "manual", ""))

	var states []saveState
	player.expectJSON(http.StatusOK, &states, player.get("/api/v1/roms/"+added.ID+"/states"))
	if len(states) != 1 || states[0].ID != manual.ID {
		t.Fatalf("manual states: %+v", states)
	}
	player.expectJSON(http.StatusOK, &states, player.get("/api/v1/roms/"+added.ID+"/states?type=auto"))
	if len(states) != 1 || states[0].ID != auto.ID {
		t.Fatalf("auto states: %+v", states)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/roms/"+added.ID+"/states?type=other"))
	if body := player.expect(http.StatusOK, player.get("/api/v1/files/"+manual.FileID)); string(body) != "state of "+added.ID {
		t.Fatalf("stored state: %q", body)
	}

	// Another player can't see, read, add to or delete them
	other.expect(http.StatusNotFound, other.get("/api/v1/roms/"+added.ID+"/states"))
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+manual.FileID))
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+manual.ThumbnailFileID))
	other.expect(http.StatusNotFound, other.saveState(added.ID, "manual", ""))
	other.expect(http.StatusNotFound, other.send(http.MethodDelete, "/api/v1/states/"+manual.ID, "", nil))

	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/states/"+manual.ID, "", nil))
	player.expect(http.StatusNotFound, player.send(http.MethodDelete, "/api/v1/states/"+manual.ID, "", nil))
	player.expectJSON(http.StatusOK, &states, player.get("/api/v1/roms/"+added.ID+"/states"))
	if len(states) != 0 {
		t.Fatalf("left: %+v", states)
	}
	// The deleted save's files go with it
	player.expect(http.StatusNotFound, player.get("/api/v1/files/"+manual.FileID))
}

type gameSave struct {
	FileID string `json:"fileId"`
	ID     string `json:"id"`
	Sha1   string `json:"sha1"`
	Size   int    `json:"size"`
}

func TestGameSaves(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	added := player.addGame("Quest (USA).nes")
	send := func(user *apiUser, content string) response {
		return user.multipart(http.MethodPost, "/api/v1/game_saves", map[string]string{"core": "fceumm", "rom": added.ID},
			map[string]uploadFile{"file": {content: []byte(content), name: "blob"}})
	}
	list := func(user *apiUser) []gameSave {
		var saves []gameSave
		user.expectJSON(http.StatusOK, &saves, user.get("/api/v1/game_saves?core=fceumm&rom="+added.ID))
		return saves
	}

	var first, second, unchanged, restored gameSave
	player.expectJSON(http.StatusOK, &first, send(player, "first"))
	player.expectJSON(http.StatusOK, &second, send(player, "second"))
	// The same content as the newest isn't kept twice
	player.expectJSON(http.StatusOK, &unchanged, send(player, "second"))
	if unchanged.ID != second.ID || first.Size != 5 {
		t.Fatalf("unchanged: %+v, second: %+v", unchanged, second)
	}
	if saves := list(player); len(saves) != 2 || saves[0].ID != second.ID || saves[1].ID != first.ID {
		t.Fatalf("saves: %+v", saves)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/game_saves?core=fceumm"))

	// Restoring the first makes a copy of it the newest
	player.expectJSON(http.StatusOK, &restored, player.send(http.MethodPost, "/api/v1/game_saves/"+first.ID+"/restore", "", nil))
	if restored.ID == first.ID || restored.Sha1 != first.Sha1 {
		t.Fatalf("restored: %+v, first: %+v", restored, first)
	}
	if body := player.expect(http.StatusOK, player.get("/api/v1/files/"+restored.FileID)); !bytes.Equal(body, []byte("first")) {
		t.Fatalf("restored content: %q", body)
	}
	if saves := list(player); len(saves) != 3 || saves[0].ID != restored.ID {
		t.Fatalf("saves: %+v", saves)
	}
	player.expect(http.StatusNotFound, player.send(http.MethodPost, "/api/v1/game_saves/missing/restore", "", nil))

	// Another player has none of them, and can't restore or add to them
	other.expect(http.StatusNotFound, other.send(http.MethodPost, "/api/v1/game_saves/"+first.ID+"/restore", "", nil))
	other.expect(http.StatusNotFound, send(other, "mine"))
	other.expect(http.StatusNotFound, other.get("/api/v1/files/"+second.FileID))
	if saves := list(other); len(saves) != 0 {
		t.Fatalf("the other player's: %+v", saves)
	}
}

// A save that waited in a browser to upload keeps the time it was made: it doesn't become the newest when it arrives
func TestLateSavesKeepTheirTime(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	added := player.addGame("Quest (USA).nes")
	hour := "3600000"

	var recent, late gameSave
	send := func(content, savedAgo string) response {
		return player.multipart(http.MethodPost, "/api/v1/game_saves", map[string]string{"core": "fceumm", "rom": added.ID, "savedAgo": savedAgo},
			map[string]uploadFile{"file": {content: []byte(content), name: "blob"}})
	}
	player.expectJSON(http.StatusOK, &recent, send("recent", "0"))
	player.expectJSON(http.StatusOK, &late, send("made an hour ago", hour))
	var saves []gameSave
	player.expectJSON(http.StatusOK, &saves, player.get("/api/v1/game_saves?core=fceumm&rom="+added.ID))
	if len(saves) != 2 || saves[0].ID != recent.ID || saves[1].ID != late.ID {
		t.Fatalf("game saves: %+v, recent %s, late %s", saves, recent.ID, late.ID)
	}
	player.expect(http.StatusBadRequest, send("never", "-5"))

	state := func(savedAgo string) response {
		return player.multipart(http.MethodPost, "/api/v1/states", map[string]string{"core": "fceumm", "rom": added.ID, "type": "manual", "savedAgo": savedAgo},
			map[string]uploadFile{"state": {content: []byte("state"), name: "blob"}, "thumbnail": {content: []byte("thumbnail"), name: "blob"}})
	}
	var recentState, lateState saveState
	player.expectJSON(http.StatusOK, &recentState, state("0"))
	player.expectJSON(http.StatusOK, &lateState, state(hour))
	var states []saveState
	player.expectJSON(http.StatusOK, &states, player.get("/api/v1/roms/"+added.ID+"/states"))
	if len(states) != 2 || states[0].ID != recentState.ID || states[1].ID != lateState.ID {
		t.Fatalf("states: %+v, recent %s, late %s", states, recentState.ID, lateState.ID)
	}
}
