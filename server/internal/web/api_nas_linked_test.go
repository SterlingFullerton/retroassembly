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

// fakeLinkedNAS stands in for the game service when a linked DS game is started: two consoles, the starter's and a
// friend's, each with its own save
type fakeLinkedNAS struct {
	mu      sync.Mutex
	key     string
	starts  []map[string]any
	games   []map[string]any
	saves   map[string][]byte
	fetched []string
}

func (f *fakeLinkedNAS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
		f.starts = append(f.starts, start)
		common := func(id string, console int, partner string) map[string]any {
			game := map[string]any{
				"console": console, "controls": start["controls"], "core": start["core"], "id": id,
				"libraryOwner": start["libraryOwner"], "linkedWith": partner, "platform": start["platform"],
				"rom": start["rom"], "startedBy": start["startedBy"], "title": start["title"],
				"keepAsCore": start["keepAsCore"], "keepAsFileType": start["keepAsFileType"],
			}
			return game
		}
		f.games = []map[string]any{common("aaaaa", 1, "bbbbb"), common("bbbbb", 2, "aaaaa")}
		_ = json.NewEncoder(w).Encode(f.games)
	case r.Method == http.MethodGet && r.URL.Path == "/games":
		_ = json.NewEncoder(w).Encode(f.games)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/save"):
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/games/"), "/save")
		f.fetched = append(f.fetched, id)
		save := f.saves[id]
		if save == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("X-Save-Sha1", "sum-of-"+string(save))
		_, _ = w.Write(save)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/save/collected"):
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/games/"), "/save/collected")
		delete(f.saves, id)
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/players"):
		_ = json.NewEncoder(w).Encode(map[string]any{"offer": "the NAS's offer", "player": 1})
	default:
		http.NotFound(w, r)
	}
}

func TestLinkedDSGamesOnTheNAS(t *testing.T) {
	nas := &fakeLinkedNAS{key: strings.Repeat("k", 32), saves: map[string][]byte{}}
	service := httptest.NewServer(nas)
	defer service.Close()
	t.Setenv("NAS_GAMES_URL", service.URL)
	t.Setenv("NAS_GAMES_KEY", nas.key)
	api := newAPI(t)
	owner := api.register(t, "owner")
	friend := api.register(t, "friend")

	// Only a DS game links
	nes := owner.addGame("Balloon Fight (U) [!].nes")
	owner.expect(http.StatusBadRequest, owner.json(http.MethodPost, "/api/v1/nas_games",
		map[string]any{"controls": "nes", "core": "fceumm", "linked": true, "rom": nes.ID}))
	if len(nas.starts) != 0 {
		t.Fatalf("a NES game was started linked: %+v", nas.starts)
	}

	var ds game
	owner.expectJSON(http.StatusOK, &ds, owner.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nds"},
		map[string]uploadFile{"file": {content: []byte("a DS game"), name: "Mario Kart DS.nds"}}))
	// The starter's console starts from their melonDS save, whichever DS emulator they play with in the browser
	owner.expect(http.StatusOK, owner.multipart(http.MethodPost, "/api/v1/game_saves",
		map[string]string{"core": "melonds", "rom": ds.ID, "fileType": "sav"},
		map[string]uploadFile{"file": {content: []byte("a melonDS save"), name: "blob"}}))

	var codes map[string]string
	start := map[string]any{"controls": "ds", "core": "desmume", "linked": true, "rom": ds.ID, "saveFileType": "dsv"}
	owner.expectJSON(http.StatusOK, &codes, owner.json(http.MethodPost, "/api/v1/nas_games", start))
	if codes["code"] != "0AAAAA" || codes["friendCode"] != "0BBBBB" {
		t.Fatalf("codes %+v", codes)
	}
	asked := nas.starts[0]
	options, _ := asked["options"].(map[string]any)
	if asked["linked"] != true || asked["core"] != "melondsds" || asked["saveType"] != nil ||
		options["melonds_mac_address_mode"] != "from-username" || options["melonds_render_mode"] != "software" ||
		options["melonds_console_mode"] != "ds" || options["melonds_show_cursor"] != "disabled" ||
		asked["keepAsCore"] != "melonds" || asked["keepAsFileType"] != "sav" {
		t.Fatalf("asked the NAS for %+v", asked)
	}
	if decoded, _ := base64.StdEncoding.DecodeString(asked["save"].(string)); string(decoded) != "a melonDS save" {
		t.Fatalf("started with the save %q", decoded)
	}

	// Pressed again, the starter's console is joined again rather than another pair started
	owner.expectJSON(http.StatusOK, &codes, owner.json(http.MethodPost, "/api/v1/nas_games", start))
	if codes["code"] != "0AAAAA" || codes["friendCode"] != "0BBBBB" || len(nas.starts) != 1 {
		t.Fatalf("pressed again: %+v, %d starts", codes, len(nas.starts))
	}

	// Join a game lists the friend's console only
	var listed []map[string]string
	friend.expectJSON(http.StatusOK, &listed, friend.get("/api/v1/play_together/invitations"))
	if len(listed) != 1 || listed[0]["code"] != "0BBBBB" || listed[0]["host"] != "owner" {
		t.Fatalf("listed %+v", listed)
	}
	// The starter's console tells them the friend's code; both say they're linked
	var found map[string]any
	owner.expectJSON(http.StatusOK, &found, owner.get("/api/v1/play_together/invitations/0aaaaa"))
	if found["linked"] != true || found["friendCode"] != "0BBBBB" {
		t.Fatalf("the starter's console %+v", found)
	}
	found = nil
	friend.expectJSON(http.StatusOK, &found, friend.get("/api/v1/play_together/invitations/0bbbbb"))
	if found["linked"] != true || found["friendCode"] != nil {
		t.Fatalf("the friend's console %+v", found)
	}

	// The starter's save is kept as their melonDS save; the friend's console's isn't kept, or even asked for
	nas.mu.Lock()
	nas.saves["aaaaa"] = []byte("played on the server")
	nas.saves["bbbbb"] = []byte("the friend's")
	nas.mu.Unlock()
	api.server.collectNASSavesOnce(context.Background())
	var saves []gameSave
	owner.expectJSON(http.StatusOK, &saves, owner.get("/api/v1/game_saves?core=melonds&rom="+ds.ID))
	if len(saves) != 2 || saves[0].Size != len("played on the server") {
		t.Fatalf("melonDS saves %+v", saves)
	}
	owner.expectJSON(http.StatusOK, &saves, owner.get("/api/v1/game_saves?core=melondsds&rom="+ds.ID))
	if len(saves) != 0 {
		t.Fatalf("kept as melonDS DS's: %+v", saves)
	}
	for _, id := range nas.fetched {
		if id == "bbbbb" {
			t.Fatal("the friend's console's save was asked for")
		}
	}
}
