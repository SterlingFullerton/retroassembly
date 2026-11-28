package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeNAS stands in for the game service on the NAS: it remembers the games it was asked to start, and the offers and
// answers passed through for each player
type fakeNAS struct {
	mu      sync.Mutex
	games   []map[string]any
	answers []string
	key     string
	// The game's own save as the NAS has it, and the checksums the app said it kept
	save      []byte
	collected []string
}

func (f *fakeNAS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer "+f.key {
		http.Error(w, "not allowed", http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/games":
		var start map[string]any
		_ = json.NewDecoder(r.Body).Decode(&start)
		start["id"] = "abcde"
		f.games = append(f.games, start)
		_ = json.NewEncoder(w).Encode(start)
	case r.Method == http.MethodGet && r.URL.Path == "/cores":
		_ = json.NewEncoder(w).Encode([]string{"fceumm", "mupen64plus_next"})
	case r.Method == http.MethodGet && r.URL.Path == "/games":
		_ = json.NewEncoder(w).Encode(f.games)
	case r.Method == http.MethodGet && r.URL.Path == "/games/abcde/save":
		if f.save == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("X-Save-Sha1", "sum-of-"+string(f.save))
		_, _ = w.Write(f.save)
	case r.Method == http.MethodPost && r.URL.Path == "/games/abcde/save/collected":
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.collected = append(f.collected, body["sha1"])
		f.save = nil
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && r.URL.Path == "/games/abcde/players":
		_ = json.NewEncoder(w).Encode(map[string]any{"offer": "the NAS's offer", "player": 2})
	case r.Method == http.MethodPost && r.URL.Path == "/games/abcde/players/2/answer":
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.answers = append(f.answers, body["answer"])
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet && r.URL.Path == "/games/abcde/states":
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "20261127-172500123", "size": 5}})
	case r.Method == http.MethodPost && r.URL.Path == "/games/abcde/states":
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "20261127-172600456", "size": 5})
	case r.Method == http.MethodPost && r.URL.Path == "/games/abcde/states/20261127-172500123/load":
		f.answers = append(f.answers, "loaded 20261127-172500123")
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet && r.URL.Path == "/games/abcde/states/20261127-172500123/picture":
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("a picture"))
	case r.Method == http.MethodDelete && r.URL.Path == "/games/abcde":
		f.games = nil
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func TestGamesOnTheNAS(t *testing.T) {
	nas := &fakeNAS{key: strings.Repeat("k", 32)}
	service := httptest.NewServer(nas)
	defer service.Close()
	t.Setenv("NAS_GAMES_URL", service.URL+"/")
	t.Setenv("NAS_GAMES_KEY", nas.key)
	api := newAPI(t)
	owner := api.register(t, "owner")
	guest := api.register(t, "guest")
	balloon := owner.addGame("Balloon Fight (U) [!].nes")

	// The emulators it has decide where it's offered
	var cores []string
	guest.expectJSON(http.StatusOK, &cores, guest.get("/api/v1/nas_games/cores"))
	if strings.Join(cores, ",") != "fceumm,mupen64plus_next" {
		t.Fatalf("cores %+v", cores)
	}

	// Started with the player’s emulator and controls; the NAS is told the game's file inside the games folder
	var started map[string]string
	start := map[string]string{"controls": "nes", "core": "fceumm", "rom": balloon.ID}
	owner.expectJSON(http.StatusOK, &started, owner.json(http.MethodPost, "/api/v1/nas_games", start))
	if started["code"] != "0ABCDE" {
		t.Fatalf("started %+v", started)
	}
	game := nas.games[0]
	// With the player's settings for the emulator, as in the browser
	if options, _ := game["options"].(map[string]any); options["fceumm_turbo_enable"] != "Both" {
		t.Fatalf("the NAS wasn't given the emulator's settings: %+v", game["options"])
	}
	if game["fileName"] != "Balloon Fight (U) [!].nes" {
		t.Fatalf("the NAS wasn't told the game's own name: %+v", game)
	}
	if file, _ := game["file"].(string); strings.HasPrefix(file, "roms/") || !strings.HasSuffix(file, ".nes") ||
		game["core"] != "fceumm" || game["controls"] != "nes" || game["startedBy"] != owner.id {
		t.Fatalf("asked the NAS for %+v", game)
	}
	owner.expect(http.StatusNotFound, owner.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": "nosuchrom"}))

	// Listed with the games people share, under the name of whoever started it, and joined the same way: the NAS makes
	// the offer, and gets the answer
	var listed []map[string]string
	guest.expectJSON(http.StatusOK, &listed, guest.get("/api/v1/play_together/invitations"))
	if len(listed) != 1 || listed[0]["code"] != "0ABCDE" || listed[0]["host"] != "owner" || listed[0]["controls"] != "nes" {
		t.Fatalf("listed %+v", listed)
	}
	path := "/api/v1/play_together/invitations/0abcde"
	// An answer with no place kept for it is turned away
	guest.expect(http.StatusGone, guest.json(http.MethodPost, path+"/answer", map[string]string{"answer": "early"}))
	var found map[string]string
	guest.expectJSON(http.StatusOK, &found, guest.get(path))
	if found["offer"] != "the NAS's offer" || found["host"] != "owner" || found["core"] != "fceumm" {
		t.Fatalf("found %+v", found)
	}
	guest.expect(http.StatusOK, guest.json(http.MethodPost, path+"/answer", map[string]string{"answer": "the answer"}))
	if len(nas.answers) != 1 || nas.answers[0] != "the answer" {
		t.Fatalf("the NAS was given %+v", nas.answers)
	}
	guest.expect(http.StatusNotFound, guest.get("/api/v1/play_together/invitations/0zzzzz"))

	// Its save states: listed, saved, loaded and pictured by anyone in it
	var states []map[string]any
	guest.expectJSON(http.StatusOK, &states, guest.get("/api/v1/nas_games/0ABCDE/states"))
	if len(states) != 1 || states[0]["id"] != "20261127-172500123" {
		t.Fatalf("states %+v", states)
	}
	var saved map[string]any
	guest.expectJSON(http.StatusOK, &saved, guest.json(http.MethodPost, "/api/v1/nas_games/0ABCDE/states", nil))
	if saved["id"] != "20261127-172600456" {
		t.Fatalf("saved %+v", saved)
	}
	guest.expect(http.StatusOK, guest.json(http.MethodPost, "/api/v1/nas_games/0ABCDE/states/20261127-172500123/load", nil))
	if nas.answers[len(nas.answers)-1] != "loaded 20261127-172500123" {
		t.Fatalf("the NAS was asked %+v", nas.answers)
	}
	if picture := guest.expect(http.StatusOK, guest.get("/api/v1/nas_games/0ABCDE/states/20261127-172500123/picture")); string(picture) != "a picture" {
		t.Fatalf("picture %q", picture)
	}
	guest.expect(http.StatusNotFound, guest.json(http.MethodPost, "/api/v1/nas_games/0ABCDE/states/..%2Fsave/load", nil))
	guest.expect(http.StatusNotFound, guest.get("/api/v1/nas_games/NOTNAS/states"))

	// Stopped by whoever started it, or an admin; not by anyone else
	guest.expect(http.StatusForbidden, guest.send(http.MethodDelete, "/api/v1/nas_games/0ABCDE", "", nil))
	owner.expect(http.StatusOK, owner.send(http.MethodDelete, "/api/v1/nas_games/0ABCDE", "", nil))
	guest.expectJSON(http.StatusOK, &listed, guest.get("/api/v1/play_together/invitations"))
	if len(listed) != 0 {
		t.Fatalf("listed after stopping %+v", listed)
	}
}

func TestGamesOnTheNASWhenNotSetUp(t *testing.T) {
	api := newAPI(t)
	owner := api.register(t, "owner")
	balloon := owner.addGame("Balloon Fight (U) [!].nes")
	owner.expect(http.StatusServiceUnavailable, owner.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": balloon.ID}))
	var listed []map[string]string
	owner.expectJSON(http.StatusOK, &listed, owner.get("/api/v1/play_together/invitations"))
	if len(listed) != 0 {
		t.Fatalf("listed %+v", listed)
	}
	var cores []string
	owner.expectJSON(http.StatusOK, &cores, owner.get("/api/v1/nas_games/cores"))
	if len(cores) != 0 {
		t.Fatalf("cores %+v", cores)
	}
}

func TestSavesOfGamesOnTheNAS(t *testing.T) {
	nas := &fakeNAS{key: strings.Repeat("k", 32)}
	service := httptest.NewServer(nas)
	defer service.Close()
	t.Setenv("NAS_GAMES_URL", service.URL)
	t.Setenv("NAS_GAMES_KEY", nas.key)
	api := newAPI(t)
	player := api.register(t, "player")
	game := player.addGame("Quest (USA).nes")
	saves := func() []gameSave {
		var list []gameSave
		player.expectJSON(http.StatusOK, &list, player.get("/api/v1/game_saves?core=fceumm&rom="+game.ID))
		return list
	}

	// The game starts on the NAS with the player's latest save, made in the browser
	player.expect(http.StatusOK, player.multipart(http.MethodPost, "/api/v1/game_saves",
		map[string]string{"core": "fceumm", "rom": game.ID},
		map[string]uploadFile{"file": {content: []byte("made in the browser"), name: "blob"}}))
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": game.ID}))
	started := nas.games[0]
	if save, _ := started["save"].(string); save == "" || started["rom"] != game.ID || started["libraryOwner"] == "" {
		t.Fatalf("started with %+v", started)
	}
	decoded, _ := base64.StdEncoding.DecodeString(started["save"].(string))
	if string(decoded) != "made in the browser" {
		t.Fatalf("started with the save %q", decoded)
	}

	// A save the game made on the NAS becomes the player's latest, and the NAS is told it was kept
	nas.mu.Lock()
	nas.save = []byte("made on the NAS")
	nas.mu.Unlock()
	api.server.collectNASSavesOnce(context.Background())
	list := saves()
	if len(list) != 2 || list[0].Size != len("made on the NAS") {
		t.Fatalf("saves after collecting %+v", list)
	}
	if len(nas.collected) != 1 || nas.collected[0] != "sum-of-made on the NAS" {
		t.Fatalf("collected %+v", nas.collected)
	}
	// Nothing new: nothing kept
	api.server.collectNASSavesOnce(context.Background())
	if len(saves()) != 2 {
		t.Fatalf("saves after nothing new %+v", saves())
	}
}
