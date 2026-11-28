package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// The game service's tests run a stand-in for a game: this test program again, with NAS_GAMES_STUB set. "ready"
// answers /status and /activity as a game does; "never" never answers. Either ends when asked to
func TestMain(m *testing.M) {
	if mode := os.Getenv("NAS_GAMES_STUB"); mode != "" {
		ending := make(chan os.Signal, 1)
		signal.Notify(ending, syscall.SIGTERM)
		if mode == "ready" {
			mux := http.NewServeMux()
			answer := func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(activity{})
			}
			mux.HandleFunc("GET /status", answer)
			mux.HandleFunc("GET /activity", answer)
			go func() { _ = http.ListenAndServe(os.Getenv("HTTP_ADDRESS"), mux) }()
		}
		<-ending
		os.Exit(0)
	}
	readyWithin = 3 * time.Second
	os.Exit(m.Run())
}

// resetService empties the service, and gives it a folder of saves of its own
func resetService(t *testing.T) string {
	t.Helper()
	saves := t.TempDir()
	t.Setenv("SAVE_DIR", saves)
	service.Lock()
	service.games, service.reserved, service.shuttingDown = map[string]*runningGame{}, map[int]bool{}, false
	service.Unlock()
	return saves
}

// stubGame starts a stand-in for a friend's console of a linked pair, whose partner isn't running
func stubGame(t *testing.T, mode string) *runningGame {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	root := filepath.Join(os.Getenv("SAVE_DIR"), "player", "games", newID())
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	game := &runningGame{
		ID: filepath.Base(root), Title: "Test", StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "melondsds",
		Console: 2, LinkedWith: "gone", address: address, done: make(chan struct{}), idleSince: now, lastInput: now,
		savePath: filepath.Join(root, "Game.srm"), saveRoot: root, workDir: t.TempDir(),
	}
	command := exec.Command(os.Args[0], "-test.run=^$")
	command.Env = append(os.Environ(), "NAS_GAMES_STUB="+mode, "HTTP_ADDRESS="+address)
	game.command = command
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	service.Lock()
	service.games[game.ID] = game
	service.Unlock()
	go watchConsole(game, command, game.done)
	t.Cleanup(func() { stopGame(game) })
	if mode == "ready" {
		if err := awaitReady(game); err != nil {
			t.Fatal(err)
		}
	}
	return game
}

func ended(game *runningGame) bool {
	service.Lock()
	defer service.Unlock()
	return game.Ended
}

// markRestarting marks a game being started again, as giveGameSave does before it starts it
func markRestarting(game *runningGame) {
	service.Lock()
	game.restarting = true
	service.Unlock()
}

func TestRestartWithSave(t *testing.T) {
	resetService(t)
	game := stubGame(t, "ready")
	old := game.command
	markRestarting(game)
	if err := restartWithSave(game, []byte("friend's save")); err != nil {
		t.Fatal(err)
	}
	if saved, _ := os.ReadFile(game.savePath); string(saved) != "friend's save" {
		t.Fatalf("the save file has %q", saved)
	}
	service.Lock()
	replaced, collected := game.command != old, game.collected
	service.Unlock()
	if ended(game) || !replaced || collected != checksum([]byte("friend's save")) {
		t.Fatalf("ended %v, process replaced %v, collected %s", ended(game), replaced, collected)
	}
	// The old process's watcher, however late, doesn't end the game started again
	time.Sleep(200 * time.Millisecond)
	if ended(game) {
		t.Fatal("the old process's end ended the game")
	}
}

func TestRestartThatCantWriteEndsTheGame(t *testing.T) {
	resetService(t)
	game := stubGame(t, "ready")
	game.savePath = filepath.Join(t.TempDir(), "missing", "Game.srm")
	game.KeepFor = &keepFor{LibraryOwner: "friend", Rom: "rom", User: "friend"}
	markRestarting(game)
	if err := restartWithSave(game, []byte("save")); err == nil {
		t.Fatal("restarted without its save")
	}
	if !ended(game) || game.KeepFor != nil {
		t.Fatalf("ended %v, kept for %+v", ended(game), game.KeepFor)
	}
}

func TestRestartNeverReadyEndsTheGame(t *testing.T) {
	resetService(t)
	game := stubGame(t, "never")
	markRestarting(game)
	if err := restartWithSave(game, []byte("save")); err == nil {
		t.Fatal("a game that never answered was ready")
	}
	if !ended(game) {
		t.Fatal("a game that never answered holds its slot")
	}
}

func TestStopDuringRestartEndsTheGame(t *testing.T) {
	resetService(t)
	game := stubGame(t, "ready")
	markRestarting(game)
	service.Lock()
	game.stopRequested = true
	service.Unlock()
	if err := restartWithSave(game, []byte("save")); !errors.Is(err, errEnding) {
		t.Fatalf("restarted a game asked to stop: %v", err)
	}
	if !ended(game) {
		t.Fatal("a game asked to stop as it restarted didn't end")
	}
}

func TestOldWatcherLeavesTheGameAlone(t *testing.T) {
	resetService(t)
	game := stubGame(t, "ready")
	other := exec.Command(os.Args[0], "-test.run=^$")
	other.Env = append(os.Environ(), "NAS_GAMES_STUB=never")
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	watched := make(chan struct{})
	go watchConsole(game, other, watched)
	_ = other.Process.Kill()
	<-watched
	if ended(game) {
		t.Fatal("a process the game no longer runs ended it")
	}
}

func serviceMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /games/{id}/save", gameSave)
	mux.HandleFunc("POST /games/{id}/save/collected", saveCollected)
	mux.HandleFunc("POST /games/{id}/save", giveGameSave)
	return mux
}

func ask(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, _ := json.Marshal(body)
	recorder := httptest.NewRecorder()
	serviceMux().ServeHTTP(recorder, httptest.NewRequest(method, path, bytes.NewReader(encoded)))
	return recorder
}

func TestGiveGameSaveOnce(t *testing.T) {
	resetService(t)
	game := &runningGame{ID: "friend", Console: 2, saveRoot: t.TempDir()}
	host := &runningGame{ID: "host", Console: 1, saveRoot: t.TempDir()}
	service.games[game.ID], service.games[host.ID] = game, host
	keep := map[string]any{"keepFor": keepFor{LibraryOwner: "friend", Rom: "rom", User: "friend"}}
	if code := ask(t, http.MethodPost, "/games/host/save", keep).Code; code != http.StatusConflict {
		t.Fatalf("the starter's console was given a save: %d", code)
	}
	if code := ask(t, http.MethodPost, "/games/friend/save", keep).Code; code != http.StatusNoContent {
		t.Fatalf("a friend with no save: %d", code)
	}
	if game.KeepFor == nil || game.KeepFor.User != "friend" {
		t.Fatalf("kept for %+v", game.KeepFor)
	}
	// Asked again, by them or anyone, the save it has stays
	other := map[string]any{"keepFor": keepFor{LibraryOwner: "other", Rom: "rom", User: "other"}, "save": []byte("x")}
	if code := ask(t, http.MethodPost, "/games/friend/save", other).Code; code != http.StatusConflict || game.KeepFor.User != "friend" {
		t.Fatalf("given again: %d, kept for %+v", code, game.KeepFor)
	}
	// And while it starts again
	game.KeepFor, game.restarting = nil, true
	if code := ask(t, http.MethodPost, "/games/friend/save", other).Code; code != http.StatusConflict {
		t.Fatalf("given while starting again: %d", code)
	}
}

func TestEndedGameSave(t *testing.T) {
	saves := resetService(t)
	root := filepath.Join(saves, "player", "games", "ended")
	_ = os.MkdirAll(root, 0o755)
	game := &runningGame{ID: "ended", Ended: true, endedAt: time.Now(), savePath: filepath.Join(root, "Game.srm"), saveRoot: root,
		collected: checksum([]byte("older"))}
	service.games[game.ID] = game
	_ = os.WriteFile(game.savePath, []byte("last"), 0o644)

	response := ask(t, http.MethodGet, "/games/ended/save", nil)
	if response.Code != http.StatusOK || response.Body.String() != "last" || response.Header().Get("X-Save-Sha1") != checksum([]byte("last")) {
		t.Fatalf("gave %d %q", response.Code, response.Body.String())
	}
	// Told an older save was kept, as one collected as the game ended: the last is still to be given
	ask(t, http.MethodPost, "/games/ended/save/collected", map[string]string{"sha1": checksum([]byte("older"))})
	if service.games["ended"] == nil {
		t.Fatal("forgotten with its last save not collected")
	}
	ask(t, http.MethodPost, "/games/ended/save/collected", map[string]string{"sha1": checksum([]byte("last"))})
	if service.games["ended"] != nil {
		t.Fatal("kept after its last save was collected")
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("its folder of saves stayed")
	}
}

func TestEndedGameSaveNotRead(t *testing.T) {
	saves := resetService(t)
	root := filepath.Join(saves, "player", "games", "ended")
	// A save that can't be read: here a folder in its place
	game := &runningGame{ID: "ended", Ended: true, savePath: filepath.Join(root, "Game.srm"), saveRoot: root}
	_ = os.MkdirAll(game.savePath, 0o755)
	service.games[game.ID] = game
	if code := ask(t, http.MethodGet, "/games/ended/save", nil).Code; code != http.StatusInternalServerError {
		t.Fatalf("answered %d", code)
	}
	if service.games["ended"] == nil {
		t.Fatal("forgotten for a save not read")
	}
	// With none at all, it's forgotten
	_ = os.Remove(game.savePath)
	if code := ask(t, http.MethodGet, "/games/ended/save", nil).Code; code != http.StatusNoContent || service.games["ended"] != nil {
		t.Fatalf("answered %d, kept %v", code, service.games["ended"] != nil)
	}
}

func TestGameSaveWhileRestarting(t *testing.T) {
	resetService(t)
	root := t.TempDir()
	game := &runningGame{ID: "friend", Console: 2, restarting: true, savePath: filepath.Join(root, "Game.srm"), saveRoot: root,
		KeepFor: &keepFor{LibraryOwner: "friend", Rom: "rom", User: "friend"}}
	_ = os.WriteFile(game.savePath, []byte("the console's blank save"), 0o644)
	service.games[game.ID] = game
	if code := ask(t, http.MethodGet, "/games/friend/save", nil).Code; code != http.StatusNoContent {
		t.Fatalf("gave the console's save as its player's: %d", code)
	}
}

func TestNotesTakenUpAgain(t *testing.T) {
	saves := resetService(t)
	root := filepath.Join(saves, "player", "games", "kept")
	_ = os.MkdirAll(root, 0o755)
	game := &runningGame{ID: "kept", Title: "Game", StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "snes9x",
		collected: "abc", savePath: filepath.Join(root, "Game.srm"), saveRoot: root}
	service.games[game.ID] = game
	if err := writeNote(game); err != nil {
		t.Fatal(err)
	}
	noNote := filepath.Join(saves, "player", "games", "never")
	_ = os.MkdirAll(noNote, 0o755)

	// As a service started again finds it
	service.games = map[string]*runningGame{}
	loadWaitingSaves()
	taken := service.games["kept"]
	if taken == nil || !taken.Ended || taken.collected != "abc" || taken.savePath != game.savePath || taken.Rom != "rom" {
		t.Fatalf("taken up as %+v", taken)
	}
	if _, err := os.Stat(noNote); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a folder with no note stayed")
	}
}

func TestWaitingSave(t *testing.T) {
	resetService(t)
	root := t.TempDir()
	left := &runningGame{ID: "left", Ended: true, endedAt: time.Now(), StartedBy: "player", LibraryOwner: "owner", Rom: "rom",
		Core: "snes9x", collected: checksum([]byte("collected")), savePath: filepath.Join(root, "Game.srm")}
	service.games[left.ID] = left
	_ = os.WriteFile(left.savePath, []byte("not collected"), 0o644)
	next := &runningGame{StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "snes9x"}
	if waiting := waitingSave(next); waiting == nil || string(waiting.content) != "not collected" {
		t.Fatalf("started from %+v", waiting)
	}
	// Kept as another emulator's, it isn't the same save
	other := *next
	other.Core = "bsnes"
	if waiting := waitingSave(&other); waiting != nil {
		t.Fatal("started from another emulator's save")
	}
	left.collected = checksum([]byte("not collected"))
	if waiting := waitingSave(next); waiting != nil {
		t.Fatal("started from a save already collected")
	}
}

func TestRunningAs(t *testing.T) {
	resetService(t)
	running := &runningGame{ID: "a", StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "melondsds", Console: 1, LinkedWith: "b"}
	friend := &runningGame{ID: "b", StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "melondsds", Console: 2, LinkedWith: "a"}
	service.games["a"], service.games["b"] = running, friend
	if runningAs(&runningGame{StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "melonds"}) != running {
		t.Fatal("a second game of the player's same copy")
	}
	if runningAs(&runningGame{StartedBy: "friend", LibraryOwner: "friend", Rom: "rom", Core: "melonds"}) != nil {
		t.Fatal("another player's game turned away")
	}
	running.Ended = true
	if runningAs(&runningGame{StartedBy: "player", LibraryOwner: "owner", Rom: "rom", Core: "melonds"}) != nil {
		t.Fatal("turned away for a game that ended")
	}
}

func TestReservePorts(t *testing.T) {
	resetService(t)
	gameSlots, firstPort = 3, 47900
	service.games["a"] = &runningGame{ID: "a", port: 47900}
	ports, err := reservePorts(2)
	if err != nil || fmt.Sprint(ports) != "[47901 47902]" {
		t.Fatalf("held %v: %v", ports, err)
	}
	if _, err := reservePorts(1); !errors.Is(err, errFull) {
		t.Fatalf("held a port twice: %v", err)
	}
	service.games["a"].Ended = true
	if ports, err := reservePorts(2); err == nil {
		t.Fatalf("held two of one free: %v", ports)
	}
	if ports, err := reservePorts(1); err != nil || ports[0] != 47900 {
		t.Fatalf("held %v: %v", ports, err)
	}
}

func TestShouldStop(t *testing.T) {
	idleFor, quietFor, quietPausedFor = time.Minute, 15*time.Minute, 30*time.Minute
	now := time.Now()
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	empty := func() *runningGame { return &runningGame{idleSince: ago(2 * time.Minute), lastInput: ago(time.Hour)} }
	playing := func() *runningGame { return &runningGame{Players: 1, idleSince: now, lastInput: ago(time.Minute)} }
	quiet := func() *runningGame { return &runningGame{Players: 1, idleSince: now, lastInput: ago(20 * time.Minute)} }
	quietPaused := quiet()
	quietPaused.paused = true
	linked := func(game *runningGame) *runningGame { game.LinkedWith = "other"; return game }
	restartingGame := linked(empty())
	restartingGame.restarting = true
	for _, test := range []struct {
		name          string
		game, partner *runningGame
		stop          bool
	}{
		{"empty", empty(), nil, true},
		{"empty a moment", &runningGame{idleSince: ago(30 * time.Second)}, nil, false},
		{"playing", playing(), nil, false},
		{"nobody moving", quiet(), nil, true},
		{"nobody moving, paused", quietPaused, nil, false},
		{"linked, the friend still in", linked(empty()), linked(playing()), false},
		{"linked, both idle", linked(empty()), linked(quiet()), true},
		{"linked, the friend's console starting again", linked(empty()), restartingGame, false},
		{"linked, the other ended", linked(empty()), &runningGame{Ended: true}, true},
	} {
		if stop := shouldStop(test.game, test.partner, now); stop != test.stop {
			t.Errorf("%s: stop %v", test.name, stop)
		}
	}
}

func TestSavesOf(t *testing.T) {
	for _, test := range []struct {
		saveType, path, folder, kind string
	}{
		{"", "/s/g/Game (USA).srm", "", ""},
		{"srm", "/s/g/Game (USA).srm", "", ""},
		{"dsv", "/s/g/Pokemon.dsv", "", "dsv"},
		{"../x", "/s/g/Game (USA).srm", "", ""},
		{"zip", "/s/g/Game (USA).srm", "/s/g/memory-stick/PSP/SAVEDATA", "zip"},
	} {
		saves := savesOf("/s/g", "/roms/nds/Game (USA).nds", "/tmp/w/game/Pokemon.nds", test.saveType)
		if saves.path != test.path || saves.folder != test.folder || saves.saveType != test.kind {
			t.Errorf("%q: %+v", test.saveType, saves)
		}
	}
}

func TestPrepareGame(t *testing.T) {
	roms := t.TempDir()
	_ = os.WriteFile(filepath.Join(roms, "Disc 1.cue"), []byte("1"), 0o644)
	_ = os.WriteFile(filepath.Join(roms, "Disc 2.cue"), []byte("2"), 0o644)
	t.Setenv("SYSTEM_SOURCE", t.TempDir())
	work := t.TempDir()
	bioses := []namedFile{{Name: "bios.bin", Content: []byte("b")}, {Name: "../escape.bin"}, {Name: ".hidden"}}
	discs := []discFile{{File: "Disc 1.cue", FileName: "Game (Disc 1).cue"}, {File: "Disc 2.cue", FileName: "Game (Disc 2).cue"}}
	launch, system, err := prepareGame(work, filepath.Join(roms, "Disc 1.cue"), roms, "Game (Disc 1).cue", bioses, discs)
	if err != nil {
		t.Fatal(err)
	}
	if list, _ := os.ReadFile(launch); filepath.Base(launch) != "Game (Disc 1).m3u" || string(list) != "Game (Disc 1).cue\nGame (Disc 2).cue\n" {
		t.Fatalf("started from %s: %q", launch, list)
	}
	entries, _ := os.ReadDir(system)
	if len(entries) != 1 || entries[0].Name() != "bios.bin" {
		t.Fatalf("system folder has %v", entries)
	}
	if _, err := os.Stat(filepath.Join(work, "escape.bin")); err == nil {
		t.Fatal("a BIOS file left its folder")
	}
	// A disc outside the games folder is read as one inside it, which isn't there
	escaping := []discFile{{File: "Disc 1.cue", FileName: "a.cue"}, {File: "../../etc/passwd", FileName: "b.cue"}}
	if _, _, err := prepareGame(t.TempDir(), filepath.Join(roms, "Disc 1.cue"), roms, "a.cue", nil, escaping); err == nil {
		t.Fatal("a disc outside the games folder was taken")
	}
	// A disc name that's a path, or hidden, isn't taken
	for _, name := range []string{"../b.cue", ".b.cue", "sub/b.cue"} {
		bad := []discFile{{File: "Disc 1.cue", FileName: "a.cue"}, {File: "Disc 2.cue", FileName: name}}
		if _, _, err := prepareGame(t.TempDir(), filepath.Join(roms, "Disc 1.cue"), roms, "a.cue", nil, bad); err == nil {
			t.Fatalf("disc name %q taken", name)
		}
	}
	// A game file name that's a path is replaced by the library's
	launch, _, err = prepareGame(t.TempDir(), filepath.Join(roms, "Disc 1.cue"), roms, "../../x.cue", nil, nil)
	if err != nil || filepath.Base(launch) != "Disc 1.cue" {
		t.Fatalf("started from %s: %v", launch, err)
	}
}

func TestPruneStates(t *testing.T) {
	saves := resetService(t)
	statesPerPlayer, statesInAll = 25, 1000
	folder := filepath.Join(saves, "player", "states", "Game", "snes9x")
	_ = os.MkdirAll(filepath.Join(folder, "auto"), 0o755)
	for index, path := range []string{"auto/20260101-000000000", "20260102-000000000", "20260103-000000000"} {
		_ = os.WriteFile(filepath.Join(folder, path+".state.gz"), make([]byte, 10), 0o644)
		_ = os.WriteFile(filepath.Join(folder, path+".jpg"), nil, 0o644)
		when := time.Now().Add(time.Duration(index-3) * time.Hour)
		_ = os.Chtimes(filepath.Join(folder, path+".state.gz"), when, when)
	}
	pruneStates("player")
	for path, kept := range map[string]bool{"auto/20260101-000000000": false, "20260102-000000000": true, "20260103-000000000": true} {
		_, stateErr := os.Stat(filepath.Join(folder, path+".state.gz"))
		_, pictureErr := os.Stat(filepath.Join(folder, path+".jpg"))
		if (stateErr == nil) != kept || (pictureErr == nil) != kept {
			t.Errorf("%s: kept %v, its picture %v", path, stateErr == nil, pictureErr == nil)
		}
	}
}

func TestSaveSizeLimit(t *testing.T) {
	saves := resetService(t)
	root := filepath.Join(saves, "player", "games", "big")
	_ = os.MkdirAll(root, 0o755)
	game := &runningGame{ID: "big", Ended: true, savePath: filepath.Join(root, "Game.srm"), saveRoot: root}
	service.games[game.ID] = game
	_ = os.WriteFile(game.savePath, make([]byte, maxSave+1), 0o644)
	if code := ask(t, http.MethodGet, "/games/big/save", nil).Code; code != http.StatusRequestEntityTooLarge || service.games["big"] == nil {
		t.Fatalf("answered %d for a save past the limit, kept %v", code, service.games["big"] != nil)
	}
	friend := &runningGame{ID: "friend", Console: 2, saveRoot: t.TempDir()}
	service.games[friend.ID] = friend
	body := map[string]any{"keepFor": keepFor{LibraryOwner: "o", Rom: "r", User: "u"}, "save": make([]byte, maxSave+1)}
	if code := ask(t, http.MethodPost, "/games/friend/save", body).Code; code != http.StatusRequestEntityTooLarge || friend.KeepFor != nil {
		t.Fatalf("given a save past the limit: %d", code)
	}
}
