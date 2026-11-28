package web

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// withNAS is the app with the fake game service as its NAS
func withNAS(t *testing.T, nas *fakeNAS) *apiSetup {
	t.Helper()
	nas.key = strings.Repeat("k", 32)
	service := httptest.NewServer(nas)
	t.Cleanup(service.Close)
	t.Setenv("NAS_GAMES_URL", service.URL)
	t.Setenv("NAS_GAMES_KEY", nas.key)
	return newAPI(t)
}

// failureOf is what an answer that failed says: its code and message
func failureOf(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var said map[string]string
	if err := json.Unmarshal(body, &said); err != nil {
		t.Fatalf("%v: %s", err, body)
	}
	return said
}

func TestServerGameLimits(t *testing.T) {
	nas := &fakeNAS{}
	api := withNAS(t, nas)
	player := api.register(t, "player")
	balloon := player.addGame("Balloon Fight (U) [!].nes")
	quest := player.addGame("Quest (USA).nes")
	start := func(rom string) response {
		return player.json(http.MethodPost, "/api/v1/nas_games", map[string]string{"controls": "nes", "core": "fceumm", "rom": rom})
	}

	// Only the settings the app shows for the emulator, at the values it offers
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/preference", map[string]any{
		"emulator": map[string]any{"core": map[string]any{"fceumm": map[string]any{
			"fceumm_overclocking": "9000%", "fceumm_turbo_enable": "None", "fceumm_made_up": "anything",
		}}},
	}))
	player.expect(http.StatusOK, start(balloon.ID))
	options, _ := nas.games[0]["options"].(map[string]any)
	if options["fceumm_turbo_enable"] != "None" || options["fceumm_overclocking"] != nil || options["fceumm_made_up"] != nil {
		t.Fatalf("options %+v", options)
	}

	// One game on the server at a time
	said := failureOf(t, player.expect(http.StatusConflict, start(quest.ID)))
	if said["code"] != "server_one_game" {
		t.Fatalf("a second game: %+v", said)
	}
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/nas_games/0ABCDE", "", nil))

	// A full server is told as one, with a code, about the server
	nas.mu.Lock()
	nas.full = true
	nas.mu.Unlock()
	said = failureOf(t, player.expect(http.StatusServiceUnavailable, start(quest.ID)))
	if said["code"] != "server_full" || strings.Contains(said["message"], "NAS") {
		t.Fatalf("full: %+v", said)
	}
	nas.mu.Lock()
	nas.full = false
	nas.mu.Unlock()

	// A save too large for the service, or one that can't be read, doesn't start the game blank
	player.expect(http.StatusOK, player.multipart(http.MethodPost, "/api/v1/game_saves",
		map[string]string{"core": "fceumm", "rom": quest.ID},
		map[string]uploadFile{"file": {content: []byte("the quest's save"), name: "blob"}}))
	if _, err := api.database.Exec(`UPDATE game_saves SET size = ? WHERE rom_id = ?`, 1<<30, quest.ID); err != nil {
		t.Fatal(err)
	}
	said = failureOf(t, player.expect(http.StatusRequestEntityTooLarge, start(quest.ID)))
	if said["code"] != "server_save_too_large" {
		t.Fatalf("too large: %+v", said)
	}
	var saves []gameSave
	player.expectJSON(http.StatusOK, &saves, player.get("/api/v1/game_saves?core=fceumm&rom="+quest.ID))
	if _, err := api.database.Exec(`UPDATE game_saves SET size = 16 WHERE rom_id = ?`, quest.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ := api.config.FilePath(saves[0].FileID)
	if err := os.Remove(stored); err != nil {
		t.Fatal(err)
	}
	said = failureOf(t, player.expect(http.StatusInternalServerError, start(quest.ID)))
	if said["code"] != "server_save_missing" || len(nas.games) != 1 {
		t.Fatalf("unreadable: %+v, %d started", said, len(nas.games))
	}
}

func TestServerGameSettingsForN64(t *testing.T) {
	nas := &fakeNAS{}
	api := withNAS(t, nas)
	player := api.register(t, "player")
	var n64 game
	player.expectJSON(http.StatusOK, &n64, player.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "n64"},
		map[string]uploadFile{"file": {content: []byte("an N64 game"), name: "Racer (USA).z64"}}))
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/preference", map[string]any{
		"emulator": map[string]any{"core": map[string]any{"mupen64plus_next": map[string]any{
			"mupen64plus-43screensize": "3840x2880", "mupen64plus-cpucore": "pure_interpreter",
			"mupen64plus-astick-deadzone": "20",
		}}},
	}))
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "n64", "core": "mupen64plus_next", "rom": n64.ID}))
	options, _ := nas.games[0]["options"].(map[string]any)
	if options["mupen64plus-43screensize"] != "640x480" || options["mupen64plus-cpucore"] != "dynamic_recompiler" ||
		options["mupen64plus-astick-deadzone"] != "20" {
		t.Fatalf("options %+v", options)
	}
}

func TestPlacesInServerGames(t *testing.T) {
	nas := &fakeNAS{}
	api := withNAS(t, nas)
	owner := api.register(t, "owner")
	guest := api.register(t, "guest")
	balloon := owner.addGame("Balloon Fight (U) [!].nes")
	owner.expect(http.StatusOK, owner.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": balloon.ID}))

	// Two devices of one player each have a place of their own, and a third waits
	path := "/api/v1/play_together/invitations/0abcde"
	var first, second map[string]any
	guest.expectJSON(http.StatusOK, &first, guest.get(path))
	guest.expectJSON(http.StatusOK, &second, guest.get(path))
	said := failureOf(t, guest.expect(http.StatusTooManyRequests, guest.get(path)))
	if said["code"] != "server_places_waiting" || first["place"] == second["place"] || first["place"] == "" {
		t.Fatalf("places %v %v, then %+v", first["place"], second["place"], said)
	}
	// Each answers for its own place, in whichever order
	guest.expect(http.StatusOK, guest.json(http.MethodPost, path+"/answer",
		map[string]any{"answer": "the phone's", "place": second["place"]}))
	guest.expect(http.StatusOK, guest.json(http.MethodPost, path+"/answer",
		map[string]any{"answer": "the laptop's", "place": first["place"]}))
	if strings.Join(nas.answers, ",") != "3: the phone's,2: the laptop's" {
		t.Fatalf("answers %+v", nas.answers)
	}
	// A place is answered once, and only by its player
	guest.expect(http.StatusGone, guest.json(http.MethodPost, path+"/answer",
		map[string]any{"answer": "again", "place": first["place"]}))
	var third map[string]any
	guest.expectJSON(http.StatusOK, &third, guest.get(path))
	owner.expect(http.StatusGone, owner.json(http.MethodPost, path+"/answer",
		map[string]any{"answer": "not mine", "place": third["place"]}))
}

func TestSavesKeptFromServerGames(t *testing.T) {
	nas := &fakeNAS{}
	api := withNAS(t, nas)
	player := api.register(t, "player")
	quest := player.addGame("Quest (USA).nes")
	saves := func() []gameSave {
		var list []gameSave
		player.expectJSON(http.StatusOK, &list, player.get("/api/v1/game_saves?core=fceumm&rom="+quest.ID))
		return list
	}
	upload := func(content string) {
		player.expect(http.StatusOK, player.multipart(http.MethodPost, "/api/v1/game_saves",
			map[string]string{"core": "fceumm", "rom": quest.ID},
			map[string]uploadFile{"file": {content: []byte(content), name: "blob"}}))
	}
	collect := func() { api.server.collectNASSavesOnce(context.Background()) }
	upload("made in the browser")
	start := map[string]string{"controls": "nes", "core": "fceumm", "rom": quest.ID}
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/nas_games", start))

	// Versions a game makes within a few minutes of each other are one, the newest; the save it started from stays
	nas.setSave("abcde", "first on the server")
	collect()
	nas.setSave("abcde", "second on the server")
	collect()
	if list := saves(); len(list) != 2 || list[0].Size != len("second on the server") ||
		list[1].Size != len("made in the browser") {
		t.Fatalf("saves %+v", list)
	}

	// A save the service wasn't told was kept isn't kept again over what the player made since
	nas.mu.Lock()
	nas.failCollected = true
	nas.mu.Unlock()
	nas.setSave("abcde", "third on the server")
	collect()
	upload("newer in the browser")
	nas.mu.Lock()
	nas.failCollected = false
	nas.mu.Unlock()
	collect()
	if list := saves(); list[0].Size != len("newer in the browser") {
		t.Fatalf("the server's save kept again over the browser's: %+v", list)
	}
	if last := nas.collected[len(nas.collected)-1]; last != "abcde:"+sha1Hex([]byte("third on the server")) {
		t.Fatalf("collected %+v", nas.collected)
	}

	// Stopping keeps the game's last save before answering
	nas.setSave("abcde", "the last on the server")
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/nas_games/0ABCDE", "", nil))
	if list := saves(); list[0].Size != len("the last on the server") {
		t.Fatalf("after stopping %+v", list)
	}

	// An ended game's save still waiting is kept before the game starts again, which starts from it
	nas.setSave("abcde", "waiting to be kept")
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/nas_games", start))
	if list := saves(); list[0].Size != len("waiting to be kept") {
		t.Fatalf("before starting again %+v", list)
	}
	again := nas.games[len(nas.games)-1]
	if decoded, _ := base64.StdEncoding.DecodeString(again["save"].(string)); string(decoded) != "waiting to be kept" ||
		again["id"] != "fghjk" {
		t.Fatalf("started again with %q (%v)", decoded, again["id"])
	}

	// A game deleted from the library has its save let go, once
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+quest.ID, "", nil))
	nas.setSave("fghjk", "its game is gone")
	collect()
	collect()
	fetched := 0
	for _, id := range nas.fetched {
		if id == "fghjk" {
			fetched++
		}
	}
	if last := nas.collected[len(nas.collected)-1]; fetched != 1 || last != "fghjk:"+sha1Hex([]byte("its game is gone")) {
		t.Fatalf("fetched %d times, collected %+v", fetched, nas.collected)
	}
}

func TestServerGamesOfADeletedAccount(t *testing.T) {
	nas := &fakeNAS{}
	api := withNAS(t, nas)
	admin := api.register(t, "admin")
	player := api.register(t, "player")
	quest := player.addGame("Quest (USA).nes")
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": quest.ID}))
	admin.expect(http.StatusOK, admin.send(http.MethodDelete, "/api/v1/users/"+player.id, "", nil))
	if strings.Join(nas.stopped, ",") != "abcde" {
		t.Fatalf("stopped %+v", nas.stopped)
	}
	nas.setSave("abcde", "made as the account was deleted")
	api.server.collectNASSavesOnce(context.Background())
	if kept := api.count(t, `SELECT COUNT(*) FROM game_saves WHERE user_id = ?`, player.id); kept != 0 {
		t.Fatalf("%d saves kept for a deleted account", kept)
	}
	if len(nas.collected) != 1 {
		t.Fatalf("the service wasn't told to let it go: %+v", nas.collected)
	}
}

func TestServerVersions(t *testing.T) {
	// A service that speaks another version of the API offers nothing, and starts nothing
	nas := &fakeNAS{version: `{"api":2,"capabilities":["linked"]}`}
	api := withNAS(t, nas)
	player := api.register(t, "player")
	balloon := player.addGame("Balloon Fight (U) [!].nes")
	var cores []string
	player.expectJSON(http.StatusOK, &cores, player.get("/api/v1/nas_games/cores"))
	if len(cores) != 0 {
		t.Fatalf("cores %+v", cores)
	}
	said := failureOf(t, player.expect(http.StatusBadGateway, player.json(http.MethodPost, "/api/v1/nas_games",
		map[string]string{"controls": "nes", "core": "fceumm", "rom": balloon.ID})))
	if said["code"] != "server_out_of_date" || len(nas.games) != 0 {
		t.Fatalf("started on another version: %+v", said)
	}

	// One that doesn't link consoles doesn't offer games with a friend
	nas = &fakeNAS{version: `{"api":1,"capabilities":[]}`}
	api = withNAS(t, nas)
	player = api.register(t, "player")
	player.expectJSON(http.StatusOK, &cores, player.get("/api/v1/nas_games/cores"))
	if strings.Join(cores, ",") != "fceumm,mupen64plus_next" {
		t.Fatalf("cores %+v", cores)
	}
}

// dsv is a DeSmuME save of a plain one
func dsv(save string) []byte {
	content := []byte(save)
	content = append(content, "|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:"...)
	for _, number := range []uint32{uint32(len(save)), uint32(len(save)), 1, 2, uint32(len(save)), 0} {
		content = binary.LittleEndian.AppendUint32(content, number)
	}
	return append(content, "|-DESMUME SAVE-|"...)
}

func TestLinkedGamesWithADeSmuMESave(t *testing.T) {
	nas := &fakeLinkedNAS{key: strings.Repeat("k", 32), saves: map[string][]byte{}, given: map[string][]map[string]any{}}
	service := httptest.NewServer(nas)
	defer service.Close()
	t.Setenv("NAS_GAMES_URL", service.URL)
	t.Setenv("NAS_GAMES_KEY", nas.key)
	api := newAPI(t)
	owner := api.register(t, "owner")
	var ds game
	owner.expectJSON(http.StatusOK, &ds, owner.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nds"},
		map[string]uploadFile{"file": {content: []byte("a DS game"), name: "Mario Kart DS.nds"}}))
	owner.expect(http.StatusOK, owner.json(http.MethodPost, "/api/v1/preference", map[string]any{
		"emulator": map[string]any{"platform": map[string]any{"nds": map[string]any{"core": "desmume"}}},
	}))
	// Their DeSmuME save is newer than their melonDS one: the linked game starts from it
	owner.expect(http.StatusOK, owner.multipart(http.MethodPost, "/api/v1/game_saves",
		map[string]string{"core": "melonds", "rom": ds.ID, "fileType": "sav"},
		map[string]uploadFile{"file": {content: []byte("old melonDS"), name: "blob"}}))
	owner.expect(http.StatusOK, owner.multipart(http.MethodPost, "/api/v1/game_saves",
		map[string]string{"core": "desmume", "rom": ds.ID, "fileType": "dsv"},
		map[string]uploadFile{"file": {content: dsv("new DeSmuME"), name: "blob"}}))
	owner.expect(http.StatusOK, owner.json(http.MethodPost, "/api/v1/nas_games",
		map[string]any{"controls": "ds", "core": "desmume", "linked": true, "rom": ds.ID}))
	if decoded, _ := base64.StdEncoding.DecodeString(nas.starts[0]["save"].(string)); string(decoded) != "new DeSmuME" {
		t.Fatalf("started with %q", decoded)
	}

	// What it makes is kept as their melonDS save, and as their DeSmuME one
	nas.mu.Lock()
	nas.saves["aaaaa"] = []byte("played onit")
	nas.mu.Unlock()
	api.server.collectNASSavesOnce(context.Background())
	var saves []gameSave
	owner.expectJSON(http.StatusOK, &saves, owner.get("/api/v1/game_saves?core=desmume&rom="+ds.ID))
	stored, _ := api.config.FilePath(saves[0].FileID)
	content, err := os.ReadFile(stored)
	if err != nil || string(content) != string(dsv("played onit")) || !strings.HasSuffix(saves[0].FileID, ".dsv") {
		t.Fatalf("DeSmuME save %q, %v (%+v)", content, err, saves)
	}
}
