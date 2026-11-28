package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"nasgames/host/savezip"
)

// The game service: what the app asks to run a game on the NAS, list the games running, and bring a player into one.
// Each game is this same program run again on its own (main.go), with a UDP port of its own for players' pictures and
// sound. The app is the only caller, and proves it with a key both are given.
//
//	POST   /games                        {platform, core, file, title, controls, startedBy, libraryOwner, rom, save}
//	                                     -> the game
//	GET    /games                        -> the games running; with ?all=1, those ended whose saves wait to be collected too
//	GET    /games/{id}/save              -> the game's own save, if it has one not yet collected
//	GET    /games/{id}/states            -> its save states, kept for the player who started it, newest first
//	POST   /games/{id}/states            -> a new one
//	GET    /games/{id}/states/{state}/picture
//	POST   /games/{id}/states/{state}/load
//	POST   /games/{id}/save/collected    {sha1}
//	POST   /games/{id}/save              {save?, keepFor: {libraryOwner, rom, user}}
//	GET    /cores                        -> the emulators it has, by name
//	DELETE /games/{id}
//	DELETE /users/{user}                 -> the player's games stopped, and all the service keeps for them removed
//	POST   /games/{id}/players           -> {player, offer}
//	POST   /games/{id}/players/{n}/answer {answer}
//
// With "linked": true, POST /games starts two consoles linked as by a DS's local wireless and answers with both, the
// starter's first: each a game of its own with its console (1 or 2) and the other's id (linkedWith). The pair pauses,
// resumes, restarts and ends together, stops when both are idle, and has no save states. The friend's console is given
// its player's save once: asked again, or while it starts again with it, it answers 409.
//
// Each game keeps its own save in a folder of its own, with a note of the game (game.json), until the app has
// collected its last save: a new game never writes over a save that's waiting, and one left by a service that stopped
// is still collected when it's back. Asked to stop (SIGTERM), the service stops every game, each keeping its save.

type runningGame struct {
	Controls string `json:"controls"`
	Core     string `json:"core"`
	// Whether the game has ended. An ended game is kept until its last save is collected
	Ended bool   `json:"ended"`
	ID    string `json:"id"`
	// Whose library the game is in, and its id there, for its save to be kept with the player's others
	LibraryOwner string `json:"libraryOwner"`
	Platform     string `json:"platform"`
	Players      int    `json:"players"`
	Rom          string `json:"rom"`
	// The kind of file the emulator keeps its own save in, such as a DS's .dsv, or nothing for one whose save the
	// frontend keeps
	SaveType  string    `json:"saveType,omitempty"`
	Started   time.Time `json:"started"`
	StartedBy string    `json:"startedBy"`
	Title     string    `json:"title"`
	// A console of a linked pair: which one, 1 for the starter's and 2 for a friend's, and the other's id
	Console    int    `json:"console,omitempty"`
	LinkedWith string `json:"linkedWith,omitempty"`
	// The emulator and kind of file the game's own save is kept as in the player's library, when not this game's own:
	// as the app asked, for a save that's the same as another emulator's
	KeepAsCore     string `json:"keepAsCore,omitempty"`
	KeepAsFileType string `json:"keepAsFileType,omitempty"`
	// For a friend's console of a linked pair, the player whose own save it was given, and whose it's kept as
	KeepFor *keepFor `json:"keepFor,omitempty"`

	address string
	command *exec.Cmd
	link    *consoleLink
	// The checksum of the save last collected, or given at the start
	collected string
	done      chan struct{}
	// The game's own folder, removed once it ends for good; and whether its console is being started again, which
	// doesn't end it
	workDir    string
	restarting bool
	endedAt    time.Time
	// Since when nobody has been in it, and since when nobody in it has moved anything, and whether it stands paused,
	// as of the last look
	idleSince time.Time
	lastInput time.Time
	paused    bool
	port      int
	// Being saved and stopped for being idle; and asked to stop, for whatever reason, which a restart then doesn't undo
	stopping      bool
	stopRequested bool
	// Where the game keeps its own save: a file, or a folder of them, zipped to be collected; both in the game's own
	// folder of saves, saveRoot, with its note
	saveFolder string
	savePath   string
	saveRoot   string
	// Whether the log has said its save has waited long to be collected
	toldWaiting bool
}

var service = struct {
	sync.Mutex
	games map[string]*runningGame
	// Media ports held for games being started, so two starts at once can't both take one
	reserved map[int]bool
	// Asked to stop: no game starts, and every one is being stopped
	shuttingDown bool
}{games: map[string]*runningGame{}, reserved: map[int]bool{}}

var (
	errFull   = errors.New("the NAS is running as many games as it may")
	errNoCore = errors.New("that emulator isn't on the NAS")
	errNoGame = errors.New("no such game")
	// The player's own game already running: two would each keep the same save of it, turn about
	errAlreadyRunning = errors.New("this player's game is already running")
	errGiven          = errors.New("the console has been given its player's save")
	errEnding         = errors.New("the game is ending")
	errShuttingDown   = errors.New("the game service is stopping")
	// Saving or loading a state of one console of a linked pair
	errLinkedStates = errors.New("a linked game has no save states")
	errBadFile      = errors.New("no such game file")
	validCore       = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
	validPlayer     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	validSaveType   = regexp.MustCompile(`^[a-z0-9]{1,8}$`)
	// How long an ended game is kept that has no save waiting to be collected; one that has is kept until it's collected
	keepEnded   = time.Hour
	idAlphabet  = "abcdefghjkmnpqrstuvwxyz23456789"
	firstPort   = 47900
	gameSlots   = 3
	idleFor     = time.Minute
	readyWithin = 30 * time.Second
	// How long a game with players in it may go with nobody moving anything, and paused, before it's idle too: a tab
	// left open overnight
	quietFor       = 15 * time.Minute
	quietPausedFor = 30 * time.Minute
	// How much the save states kept for one player may take, and for all of them, before the oldest go
	statesPerPlayer = int64(2 << 30)
	statesInAll     = int64(20 << 30)
	// How long the service gives each game to keep a save state and its save when the service is asked to stop
	stateOnShutdown = 10 * time.Second
	// This program, which each game is run as
	self string
)

func serve() {
	key := os.Getenv("SERVICE_KEY")
	if len(key) < 32 {
		log.Fatal("SERVICE_KEY must be set, at least 32 characters")
	}
	// Asked to stop, as by `docker stop`: every game is stopped as its player's End would, keeping its save, and a
	// state of it for a game of one console, rather than killed with the service. Each is given stateOnShutdown for its
	// state and five seconds to end, all at once: under 20 seconds in all, however many are running
	ending := make(chan os.Signal, 1)
	signal.Notify(ending, syscall.SIGTERM, syscall.SIGINT)
	firstPort = envInt("FIRST_MEDIA_PORT", firstPort)
	gameSlots = envInt("MAX_GAMES", gameSlots)
	idleFor = time.Duration(envInt("IDLE_MINUTES", 1)) * time.Minute
	quietFor = time.Duration(envInt("QUIET_MINUTES", 15)) * time.Minute
	quietPausedFor = 2 * quietFor
	statesPerPlayer = int64(envInt("STATES_MB_PER_PLAYER", 2048)) << 20
	statesInAll = int64(envInt("STATES_MB_IN_ALL", 20480)) << 20
	var err error
	self, err = os.Executable()
	check(err)
	// The service's memory, and its settings with its key, can't be read by its games, which run as the same user
	// and run players' saves through emulators
	_, _, _ = syscall.RawSyscall(syscall.SYS_PRCTL, syscall.PR_SET_DUMPABLE, 0, 0)
	// What games of a service that stopped left behind: their folders and link sockets. Their saves, still to be
	// collected, are taken up again
	for _, pattern := range []string{"nas-game-*", "nas-link-*"} {
		left, _ := filepath.Glob(filepath.Join(os.TempDir(), pattern))
		for _, path := range left {
			_ = os.RemoveAll(path)
		}
	}
	loadWaitingSaves()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /games", startGame)
	mux.HandleFunc("GET /games", listGames)
	mux.HandleFunc("GET /cores", listCores)
	mux.HandleFunc("DELETE /games/{id}", stopGameRequest)
	mux.HandleFunc("GET /games/{id}/save", gameSave)
	mux.HandleFunc("POST /games/{id}/save/collected", saveCollected)
	mux.HandleFunc("POST /games/{id}/save", giveGameSave)
	mux.HandleFunc("DELETE /users/{user}", forgetUser)
	mux.HandleFunc("POST /games/{id}/players", func(w http.ResponseWriter, r *http.Request) {
		// Someone is joining: the game isn't idle, whatever the last look found
		service.Lock()
		if game := service.games[r.PathValue("id")]; game != nil && !game.Ended {
			game.idleSince = time.Now()
		}
		service.Unlock()
		forward(w, r, "/players")
	})
	mux.HandleFunc("POST /games/{id}/players/{player}/answer", func(w http.ResponseWriter, r *http.Request) {
		forward(w, r, "/players/"+r.PathValue("player")+"/answer")
	})
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		mux.HandleFunc(method+" /games/{id}/states", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost && refuseLinked(w, r) {
				return
			}
			forward(w, r, "/states")
			if r.Method == http.MethodPost {
				if game := findGame(r.PathValue("id")); game != nil {
					pruneStates(game.StartedBy)
				}
			}
		})
	}
	mux.HandleFunc("GET /games/{id}/states/{state}/picture", func(w http.ResponseWriter, r *http.Request) {
		forward(w, r, "/states/"+r.PathValue("state")+"/picture")
	})
	mux.HandleFunc("POST /games/{id}/states/{state}/load", func(w http.ResponseWriter, r *http.Request) {
		if refuseLinked(w, r) {
			return
		}
		forward(w, r, "/states/"+r.PathValue("state")+"/load")
	})
	keyed := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		given, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(given), []byte(key)) != 1 {
			http.Error(w, "not allowed", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
	go watchGames()
	address := envOr("SERVICE_ADDRESS", ":8098")
	log.Printf("game service on %s: up to %d games, media ports from %d, stopped after %v without players",
		address, gameSlots, firstPort, idleFor)
	server := &http.Server{Addr: address, Handler: keyed}
	go func() {
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ending
	log.Printf("stopping every game")
	stopEveryGame()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	log.Printf("game service stopped")
}

// stopEveryGame stops every game at once, each keeping its save, and a state of a game of one console
func stopEveryGame() {
	service.Lock()
	service.shuttingDown = true
	var running []*runningGame
	for _, game := range service.games {
		if !game.Ended {
			running = append(running, game)
		}
	}
	service.Unlock()
	var group sync.WaitGroup
	for _, game := range running {
		group.Go(func() {
			if game.LinkedWith == "" {
				saveBeforeStopping(game, stateOnShutdown)
			}
			stopGame(game)
		})
	}
	group.Wait()
}

func newID() string {
	random := make([]byte, 5)
	_, _ = rand.Read(random)
	id := make([]byte, len(random))
	for index, value := range random {
		id[index] = idAlphabet[int(value)%len(idAlphabet)]
	}
	return string(id)
}

// startRequest is what the app asks a game to be started with
type startRequest struct {
	Controls     string            `json:"controls"`
	Core         string            `json:"core"`
	File         string            `json:"file"`
	LibraryOwner string            `json:"libraryOwner"`
	Options      map[string]string `json:"options"`
	Platform     string            `json:"platform"`
	Rom          string            `json:"rom"`
	// The player's BIOS files for the console, put in the emulator's system folder as the browser does
	Bioses []namedFile `json:"bioses"`
	// The other discs of a game on several, in order, this one among them: played from a list of them all
	Discs []discFile `json:"discs"`
	// The game's own file name, which some emulators read its region or set from: arcade ones above all
	FileName string `json:"fileName"`
	// The player's latest save of the game, which it starts with: as bytes, so base64 in JSON
	Save []byte `json:"save"`
	// The kind of file the emulator keeps its own save in, beside the game's name: a DS's .dsv or .sav
	SaveType  string `json:"saveType"`
	StartedBy string `json:"startedBy"`
	Title     string `json:"title"`
	// Two consoles linked as by a DS's local wireless, each a game of its own with its own code, players and picture:
	// the second for a friend, who joins it with its code
	Linked bool `json:"linked"`
	// The emulator and kind of file the game's own save is to be kept as in the player's library, passed back with
	// the game: the app's to decide, for a save another emulator's are the same as
	KeepAsCore     string `json:"keepAsCore"`
	KeepAsFileType string `json:"keepAsFileType"`
}

func startGame(w http.ResponseWriter, r *http.Request) {
	var request startRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 128<<20)).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !request.Linked {
		ports, err := reservePorts(1)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		game, status, err := startConsole(request, newID(), nil, ports[0])
		if err != nil {
			http.Error(w, err.Error(), status)
			return
		}
		writeJSONTo(w, http.StatusOK, snapshot(game))
		return
	}
	// A linked pair needs two slots, both held at once, and starts both or neither. They start side by side, so the
	// pair is ready in the time one console takes
	ports, err := reservePorts(2)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	first, second := newID(), newID()
	// The friend's console keeps its save apart from the starter's: it's not theirs to have overwritten
	friend := request
	friend.Save = nil
	var host, guest *runningGame
	var hostStatus, guestStatus int
	var hostErr, guestErr error
	var group sync.WaitGroup
	group.Go(func() {
		host, hostStatus, hostErr = startConsole(request, first, &consoleLink{console: 1, host: first, partner: second}, ports[0])
	})
	group.Go(func() {
		guest, guestStatus, guestErr = startConsole(friend, second, &consoleLink{console: 2, host: first, partner: first}, ports[1])
	})
	group.Wait()
	if hostErr != nil || guestErr != nil {
		for _, game := range []*runningGame{host, guest} {
			if game != nil {
				stopGame(game)
			}
		}
		if hostErr != nil {
			http.Error(w, hostErr.Error(), hostStatus)
		} else {
			http.Error(w, guestErr.Error(), guestStatus)
		}
		return
	}
	writeJSONTo(w, http.StatusOK, []runningGame{snapshot(host), snapshot(guest)})
}

// snapshot is a game as it is now, to be answered with: its fields change under the service's lock
func snapshot(game *runningGame) runningGame {
	service.Lock()
	defer service.Unlock()
	return *game
}

// reservePorts holds media ports for games about to start, all or none: each is let go once its game is running, or
// failed to start
func reservePorts(count int) ([]int, error) {
	service.Lock()
	defer service.Unlock()
	if service.shuttingDown {
		return nil, errShuttingDown
	}
	var ports []int
	for slot := 0; slot < gameSlots && len(ports) < count; slot++ {
		port := firstPort + slot
		taken := service.reserved[port]
		for _, game := range service.games {
			taken = taken || (!game.Ended && game.port == port)
		}
		if !taken {
			ports = append(ports, port)
		}
	}
	if len(ports) < count {
		return nil, errFull
	}
	for _, port := range ports {
		service.reserved[port] = true
	}
	return ports, nil
}

// startConsole starts one console of a game on a port reservePorts held for it, linked to another if link says so,
// and answers once it's ready
func startConsole(request startRequest, id string, link *consoleLink, port int) (*runningGame, int, error) {
	// The port is the game's once it runs; until then, and if it never does, it's let go here
	defer func() {
		service.Lock()
		delete(service.reserved, port)
		service.Unlock()
	}()
	corePath := filepath.Join("/cores", request.Core+"_libretro.so")
	if !validCore.MatchString(request.Core) {
		return nil, http.StatusBadRequest, errNoCore
	}
	if _, err := os.Stat(corePath); err != nil {
		return nil, http.StatusNotFound, errNoCore
	}
	// Only files in the games folder: a path that leaves it is refused
	romsDir := envOr("ROMS_DIR", "/roms")
	gamePath := filepath.Join(romsDir, filepath.Clean("/"+request.File))
	if info, err := os.Stat(gamePath); err != nil || info.IsDir() {
		return nil, http.StatusNotFound, errBadFile
	}
	if !validPlayer.MatchString(request.StartedBy) {
		return nil, http.StatusBadRequest, errors.New("no such player")
	}
	// The game as the emulator sees it: under its own name, with its BIOS files, in a folder of the game's own
	workDir := filepath.Join(os.TempDir(), "nas-game-"+newID())
	launchPath, systemDir, err := prepareGame(workDir, gamePath, romsDir, request.FileName, request.Bioses, request.Discs)
	// The game's own saves: its save, which is the app's latest when it starts, and a PSP's memory stick, in a folder
	// of this game's own in its starter's, kept until its last save is collected
	playerDir := filepath.Join(envOr("SAVE_DIR", "/config/saves"), request.StartedBy)
	saves := savesOf(filepath.Join(playerDir, "games", id), gamePath, launchPath, request.SaveType)
	// Removed when the game ends; and here, if it never starts
	running := false
	defer func() {
		if !running {
			_ = os.RemoveAll(workDir)
			_ = os.RemoveAll(saves.root)
		}
	}()
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	if err := os.MkdirAll(saves.dir, 0o755); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	game := &runningGame{
		Controls: request.Controls, Core: request.Core, ID: id, LibraryOwner: request.LibraryOwner,
		Platform: request.Platform, Rom: request.Rom, SaveType: saves.saveType, Started: time.Now(), StartedBy: request.StartedBy,
		Title: request.Title, KeepAsCore: request.KeepAsCore, KeepAsFileType: request.KeepAsFileType,
		saveFolder: saves.folder, savePath: saves.path, saveRoot: saves.root,
		address: fmt.Sprintf("127.0.0.1:%d", port+1000), done: make(chan struct{}), idleSince: time.Now(),
		lastInput: time.Now(), port: port, workDir: workDir, link: link,
	}
	if link != nil {
		game.Console, game.LinkedWith = link.console, link.partner
	}
	// A save of the player's game on the server that the app hasn't collected yet, from a game that ended moments
	// ago, is newer than the app's latest: the game starts from it, and it's still collected from the game that made it
	start := request.Save
	if waiting := waitingSave(game); waiting != nil {
		log.Printf("game %s (%s): starting from the save game %s left, not yet collected", id, request.Title, waiting.from)
		start = waiting.content
	}
	if saves.folder != "" {
		// The save given is put in place of whatever the folder had
		var files []savezip.File
		if len(start) > 0 {
			unzipped, err := savezip.Unzip(start, "SAVEDATA")
			if err != nil {
				return nil, http.StatusBadRequest, errors.New("the game's save couldn't be read: " + err.Error())
			}
			files = unzipped
			game.collected = checksum(savezip.Zip(files))
		}
		if err := savezip.Write(saves.folder, files); err != nil {
			return nil, http.StatusInternalServerError, err
		}
	} else if len(start) > 0 {
		if err := os.WriteFile(saves.path, start, 0o644); err != nil {
			return nil, http.StatusInternalServerError, err
		}
		game.collected = checksum(start)
	}
	// The note that has the game's save collected even if this service stops before it is
	if err := writeNote(game); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	var options []string
	for key, value := range request.Options {
		if strings.ContainsAny(key+value, ";=\n") {
			continue
		}
		options = append(options, key+"="+value)
	}
	saveName := strings.TrimSuffix(filepath.Base(gamePath), filepath.Ext(gamePath))
	statesDir := filepath.Join(playerDir, "states", saveName, request.Core)
	takeOldStates(filepath.Dir(statesDir), statesDir)
	command := exec.Command(self)
	command.Env = append(gameEnv(),
		"GAME="+launchPath, "SYSTEM_DIR="+systemDir,
		"SAVE_NAME="+saveName, "CORE_PATH="+corePath, "CORE_OPTIONS="+strings.Join(options, ";"),
		"HTTP_ADDRESS="+game.address, "MEDIA_PORT="+strconv.Itoa(port), "SAVE_DIR="+saves.dir, "STATES_DIR="+statesDir)
	if link != nil {
		command.Env = append(command.Env, link.env()...)
	}
	prefix := fmt.Sprintf("[%s] ", game.ID)
	command.Stdout = &prefixed{prefix: prefix, out: os.Stdout}
	command.Stderr = &prefixed{prefix: prefix, out: os.Stderr}
	game.command = command

	service.Lock()
	if service.shuttingDown {
		service.Unlock()
		return nil, http.StatusServiceUnavailable, errShuttingDown
	}
	if other := runningAs(game); other != nil {
		service.Unlock()
		return nil, http.StatusConflict, errAlreadyRunning
	}
	if err := command.Start(); err != nil {
		service.Unlock()
		return nil, http.StatusInternalServerError, err
	}
	service.games[game.ID] = game
	running = true
	service.Unlock()
	go watchConsole(game, command, game.done)
	if err := awaitReady(game); err != nil {
		return nil, http.StatusGatewayTimeout, err
	}
	log.Printf("game %s started: %s, %s, port %d", game.ID, game.Title, request.Core, port)
	return game, http.StatusOK, nil
}

// gameSaves is where a game keeps its own save
type gameSaves struct {
	// The game's own folder of saves, and the folder the emulator is given as its save folder
	root, dir string
	// The save's file, or for a PSP, its folder of saves on the memory stick, zipped to be collected
	path, folder string
	// The kind of file the emulator keeps its own save in, beside the game's name, or zip for a PSP's folder; none
	// for a save the frontend keeps (.srm)
	saveType string
}

// savesOf is where a game keeps its save in its own folder of saves, root: as the frontend names it, after the
// library's copy of the game; as an emulator that keeps its save itself names it, after the file it was started
// with; or on a PSP's memory stick
func savesOf(root, gamePath, launchPath, saveType string) gameSaves {
	saves := gameSaves{root: root, dir: root}
	saves.path = filepath.Join(root, strings.TrimSuffix(filepath.Base(gamePath), filepath.Ext(gamePath))+".srm")
	if validSaveType.MatchString(saveType) && saveType != "srm" && saveType != "zip" {
		saves.saveType = saveType
		saves.path = filepath.Join(root, strings.TrimSuffix(filepath.Base(launchPath), filepath.Ext(launchPath))+"."+saveType)
	}
	if saveType == "zip" {
		saves.saveType = "zip"
		saves.dir = filepath.Join(root, "memory-stick")
		saves.folder = filepath.Join(saves.dir, "PSP", "SAVEDATA")
	}
	return saves
}

// gameEnv is what of the service's own settings a game is given: what the emulators, the GPU's drivers and the
// game's network need, and nothing else. The service's key above all stays with the service: a game runs players'
// saves through emulators, and one that a crafted save took over mustn't be able to drive the service
func gameEnv() []string {
	names := map[string]bool{"PATH": true, "HOME": true, "USER": true, "LANG": true, "TZ": true, "TMPDIR": true,
		"ICE_INTERFACES": true, "REACHABLE_AT": true, "GODEBUG": true, "GOMAXPROCS": true}
	prefixes := []string{"LC_", "XDG_", "MESA_", "LIBGL_", "EGL_", "__EGL_", "__GLX_", "GALLIUM_", "VK_", "RADV_", "AMD_",
		"INTEL_", "ANV_", "IRIS_", "NVIDIA_", "LIBVA_", "DRI_"}
	var env []string
	for _, pair := range os.Environ() {
		name, _, _ := strings.Cut(pair, "=")
		keep := names[name]
		for _, prefix := range prefixes {
			keep = keep || strings.HasPrefix(name, prefix)
		}
		if keep && name != "SERVICE_KEY" {
			env = append(env, pair)
		}
	}
	return env
}

// takeOldStates moves the save states kept before they were kept for each emulator, in the game's folder of states,
// into the first emulator's to start the game since: most players play a game with one
func takeOldStates(old, statesDir string) {
	if _, err := os.Stat(statesDir); !errors.Is(err, os.ErrNotExist) {
		return
	}
	entries, err := os.ReadDir(old)
	if err != nil {
		return
	}
	var files []string
	for _, entry := range entries {
		if entry.Type().IsRegular() {
			files = append(files, entry.Name())
		}
	}
	if len(files) == 0 || os.MkdirAll(statesDir, 0o755) != nil {
		return
	}
	for _, name := range files {
		_ = os.Rename(filepath.Join(old, name), filepath.Join(statesDir, name))
	}
}

// watchConsole waits for a console's process to end, and ends its game: unless it's been started again, or is being
func watchConsole(game *runningGame, command *exec.Cmd, done chan struct{}) {
	_ = command.Wait()
	service.Lock()
	// Decided by the process, under the lock: a watcher of a process a restart replaced has nothing to end
	ends := game.command == command && !game.restarting
	if ends {
		game.Ended, game.endedAt, game.Players = true, time.Now(), 0
	}
	service.Unlock()
	close(done)
	if ends {
		finishEnded(game)
	}
}

// finishEnded clears up after a game that has ended for good, and ends the other console of a linked pair: one
// can't play on alone, as the other's wireless would wait on it. Its save stays until it's collected
func finishEnded(game *runningGame) {
	_ = os.RemoveAll(game.workDir)
	if game.link != nil {
		for _, kind := range []string{"wireless", "control"} {
			_ = os.Remove(linkSocket(game.link.host, game.link.console, kind))
		}
	}
	log.Printf("game %s (%s) ended", game.ID, game.Title)
	if partner := partnerOf(game); partner != nil {
		stopGame(partner)
	}
}

// awaitReady waits for a console to answer; one that never does is stopped
func awaitReady(game *runningGame) error {
	service.Lock()
	done := game.done
	service.Unlock()
	for deadline := time.Now().Add(readyWithin); time.Now().Before(deadline); {
		select {
		case <-done:
			return errors.New("the game stopped as it started")
		case <-time.After(250 * time.Millisecond):
		}
		if _, err := status(game); err == nil {
			return nil
		}
	}
	stopGame(game)
	return errors.New("the game didn't start in time")
}

// restartWithSave starts a console's game again from the start with a save in place of its own: an emulator that reads
// its save only as the game loads, as melonDS DS does, sees it then. Its process is started anew with all else the same:
// its code, its port, and for a linked console, its link to the other. The caller has marked the game restarting,
// under the lock, so no other restart runs at once. A game asked to stop meanwhile ends instead; and one that can't
// start again ends, with its partner, rather than holding its slot with no game in it
func restartWithSave(game *runningGame, save []byte) error {
	service.Lock()
	old, oldDone := game.command, game.done
	service.Unlock()
	endProcess(old, oldDone)
	end := func(err error) error {
		service.Lock()
		game.restarting = false
		game.Ended, game.endedAt, game.Players = true, time.Now(), 0
		service.Unlock()
		finishEnded(game)
		return err
	}
	// Written once the old process has kept its own save as it ended
	if err := os.WriteFile(game.savePath, save, 0o644); err != nil {
		// What the old process kept is no one's: it was the console's before its player came
		service.Lock()
		game.KeepFor = nil
		service.Unlock()
		_ = writeNote(game)
		return end(err)
	}
	service.Lock()
	game.collected = checksum(save)
	ending := game.stopRequested || service.shuttingDown
	service.Unlock()
	_ = writeNote(game)
	if ending {
		return end(errEnding)
	}
	command := exec.Command(old.Path)
	command.Env, command.Stdout, command.Stderr = old.Env, old.Stdout, old.Stderr
	done := make(chan struct{})
	service.Lock()
	if game.stopRequested || service.shuttingDown {
		service.Unlock()
		return end(errEnding)
	}
	if err := command.Start(); err != nil {
		service.Unlock()
		return end(err)
	}
	game.command, game.done, game.restarting, game.Players = command, done, false, 0
	// Started again just now: not idle, whatever it was before
	game.idleSince, game.lastInput = time.Now(), time.Now()
	service.Unlock()
	go watchConsole(game, command, done)
	return awaitReady(game)
}

// listCores is the emulators the NAS has, by the names the app gives them
func listCores(w http.ResponseWriter, _ *http.Request) {
	files, _ := filepath.Glob("/cores/*_libretro.so")
	names := make([]string, 0, len(files))
	for _, file := range files {
		names = append(names, strings.TrimSuffix(filepath.Base(file), "_libretro.so"))
	}
	writeJSONTo(w, http.StatusOK, names)
}

func listGames(w http.ResponseWriter, r *http.Request) {
	all := r.URL.Query().Get("all") == "1"
	service.Lock()
	games := make([]runningGame, 0, len(service.games))
	for _, game := range service.games {
		if all || !game.Ended {
			games = append(games, *game)
		}
	}
	service.Unlock()
	writeJSONTo(w, http.StatusOK, games)
}

// refuseLinked turns away saving or loading a state of a linked console: two consoles can't be put back in step, and
// one put back alone would no longer match the other. Whether it was turned away
func refuseLinked(w http.ResponseWriter, r *http.Request) bool {
	game := findGame(r.PathValue("id"))
	if game == nil || game.LinkedWith == "" {
		return false
	}
	http.Error(w, errLinkedStates.Error(), http.StatusConflict)
	return true
}

// partnerOf is the other console of a linked pair, while it runs
func partnerOf(game *runningGame) *runningGame {
	if game.LinkedWith == "" {
		return nil
	}
	return findGame(game.LinkedWith)
}

// findGame is a game still running
func findGame(id string) *runningGame {
	service.Lock()
	defer service.Unlock()
	if game := service.games[id]; game != nil && !game.Ended {
		return game
	}
	return nil
}

// keepFor is a player's copy of a game in a library: whose library, the game's id there, and the player
type keepFor struct {
	LibraryOwner string `json:"libraryOwner"`
	Rom          string `json:"rom"`
	User         string `json:"user"`
}

// giveGameSave puts a player's own save into the friend's console of a linked pair, which started before its player
// was known, and starts its game again so it reads it. The console's save is kept as that player's from then on. A
// console is given a save once: asked again, or while it's starting again, it answers 409, and the save it has stays
func giveGameSave(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Save    []byte  `json:"save"`
		KeepFor keepFor `json:"keepFor"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 128<<20)).Decode(&body); err != nil ||
		body.KeepFor.LibraryOwner == "" || body.KeepFor.Rom == "" || body.KeepFor.User == "" {
		http.Error(w, "whose save it is", http.StatusBadRequest)
		return
	}
	service.Lock()
	game := service.games[r.PathValue("id")]
	var refused error
	status := http.StatusConflict
	switch {
	case game == nil || game.Ended:
		refused, status = errNoGame, http.StatusNotFound
	case game.Console != 2:
		refused = errors.New("only a friend's console of a linked pair is given a save")
	case game.KeepFor != nil || game.restarting:
		refused = errGiven
	case game.stopping || game.stopRequested || service.shuttingDown:
		refused, status = errEnding, http.StatusGone
	}
	if refused != nil {
		service.Unlock()
		http.Error(w, refused.Error(), status)
		return
	}
	// Taken before the restart, so a second ask meanwhile is turned away
	game.KeepFor = &body.KeepFor
	game.restarting = len(body.Save) > 0
	service.Unlock()
	_ = writeNote(game)
	// A player with no save of the game yet keeps what the console makes from its blank one
	if len(body.Save) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := restartWithSave(game, body.Save); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("game %s (%s): started again with its player's save", game.ID, game.Title)
	w.WriteHeader(http.StatusNoContent)
}

// saveOwner is whose save a game's is, as the app keeps it: the player, their copy of the game, and the emulator
// and kind of file it's kept as. A game whose save no one keeps, as a friend's console nobody was given, has none
type saveOwner struct {
	user, libraryOwner, rom, core, fileType string
}

func ownerOf(game *runningGame) (saveOwner, bool) {
	owner := saveOwner{user: game.StartedBy, libraryOwner: game.LibraryOwner, rom: game.Rom, core: game.Core, fileType: game.SaveType}
	if game.Console == 2 {
		if game.KeepFor == nil {
			return saveOwner{}, false
		}
		owner.user, owner.libraryOwner, owner.rom = game.KeepFor.User, game.KeepFor.LibraryOwner, game.KeepFor.Rom
	}
	if game.KeepAsCore != "" {
		owner.core, owner.fileType = game.KeepAsCore, game.KeepAsFileType
	}
	return owner, owner.user != "" && owner.libraryOwner != "" && owner.rom != ""
}

// runningAs is a game running that keeps its save as the same player's of the same copy of the game: two at once
// would each keep theirs as a version of the one save, turn about
func runningAs(game *runningGame) *runningGame {
	owner, ok := ownerOf(game)
	if !ok {
		return nil
	}
	for _, other := range service.games {
		if theirs, kept := ownerOf(other); kept && !other.Ended && other != game &&
			theirs.user == owner.user && theirs.libraryOwner == owner.libraryOwner && theirs.rom == owner.rom {
			return other
		}
	}
	return nil
}

type waiting struct {
	content []byte
	from    string
}

// waitingSave is the save an ended game of the same player's same copy, kept the same way, left and the app hasn't
// collected yet, if there's one: the newest
func waitingSave(game *runningGame) *waiting {
	owner, ok := ownerOf(game)
	if !ok {
		return nil
	}
	service.Lock()
	var newest *runningGame
	for _, other := range service.games {
		if theirs, kept := ownerOf(other); kept && other.Ended && theirs == owner &&
			(newest == nil || other.endedAt.After(newest.endedAt)) {
			newest = other
		}
	}
	var path, folder, collected string
	if newest != nil {
		path, folder, collected = newest.savePath, newest.saveFolder, newest.collected
	}
	service.Unlock()
	if newest == nil {
		return nil
	}
	content, err := readSave(path, folder)
	if err != nil || len(content) == 0 || checksum(content) == collected {
		return nil
	}
	return &waiting{content: content, from: newest.ID}
}

// readSave is a game's own save as it is now: its file, or its folder's files zipped as the browser does, so the same
// saves are the same bytes. Nothing, when there's none
func readSave(path, folder string) ([]byte, error) {
	if folder != "" {
		files, err := savezip.Read(folder)
		if err != nil || len(files) == 0 {
			return nil, err
		}
		return savezip.Zip(files), nil
	}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return content, err
}

// The game's own save, as the game last kept it, when it isn't the one collected last. A game keeps its save every
// few seconds while it runs, and as it ends
func gameSave(w http.ResponseWriter, r *http.Request) {
	service.Lock()
	game := service.games[r.PathValue("id")]
	var path, folder, collected string
	restarting := false
	if game != nil {
		path, folder, collected, restarting = game.savePath, game.saveFolder, game.collected, game.restarting
	}
	service.Unlock()
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	// A console starting again with its player's save has, for now, only what it had before them
	if restarting {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	content, err := readSave(path, folder)
	if err != nil {
		// Not read this time, which isn't nothing new: the game is kept, to be asked again
		log.Printf("game %s (%s): couldn't read its save: %v", game.ID, game.Title, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(content) == 0 || checksum(content) == collected {
		// Nothing new: an ended game has nothing left to give, and is forgotten
		forgetEnded(game, content)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Save-Sha1", checksum(content))
	_, _ = w.Write(content)
}

// saveCollected is told the app has kept the game's save. An ended game is then forgotten, if what it was told is
// kept is the save it has: one collected as it was ending has a last save still to give
func saveCollected(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Sha1 string `json:"sha1"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	service.Lock()
	game := service.games[r.PathValue("id")]
	if game != nil {
		game.collected = body.Sha1
	}
	var path, folder string
	ended := false
	if game != nil {
		path, folder, ended = game.savePath, game.saveFolder, game.Ended
	}
	service.Unlock()
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	if ended {
		if content, err := readSave(path, folder); err == nil {
			forgetEnded(game, content)
		}
	}
	_ = writeNote(game)
	w.WriteHeader(http.StatusNoContent)
}

// forgetEnded forgets an ended game whose save, `content` as just read, has been collected or is nothing, with its
// folder of saves. Whether it was
func forgetEnded(game *runningGame, content []byte) bool {
	service.Lock()
	forget := game.Ended && service.games[game.ID] == game && (len(content) == 0 || checksum(content) == game.collected)
	if forget {
		delete(service.games, game.ID)
	}
	service.Unlock()
	if forget {
		_ = os.RemoveAll(game.saveRoot)
	}
	return forget
}

// A game's note, kept with its save: the game as the app knows it, and where its save is and which was collected
type gameNote struct {
	Game       runningGame `json:"game"`
	Collected  string      `json:"collected"`
	SavePath   string      `json:"savePath"`
	SaveFolder string      `json:"saveFolder"`
}

const noteName = "game.json"

// Notes are written one at a time, so an older one is never written over a newer
var notes sync.Mutex

// writeNote keeps a game's note with its save, written whole, then named, so it's never seen half written
func writeNote(game *runningGame) error {
	notes.Lock()
	defer notes.Unlock()
	service.Lock()
	note := gameNote{Game: *game, Collected: game.collected, SavePath: game.savePath, SaveFolder: game.saveFolder}
	root := game.saveRoot
	gone := game.Ended && service.games[game.ID] != game
	service.Unlock()
	if gone || root == "" {
		return nil
	}
	data, err := json.Marshal(note)
	if err != nil {
		return err
	}
	path := filepath.Join(root, noteName)
	if err := os.WriteFile(path+".part", data, 0o644); err != nil {
		return err
	}
	return os.Rename(path+".part", path)
}

// loadWaitingSaves takes up the games a service that stopped left, from their notes: each has ended, and its save is
// collected as any ended game's is. A game's folder of saves with no note never started, and goes
func loadWaitingSaves() {
	folders, _ := filepath.Glob(filepath.Join(envOr("SAVE_DIR", "/config/saves"), "*", "games", "*"))
	service.Lock()
	defer service.Unlock()
	for _, folder := range folders {
		data, err := os.ReadFile(filepath.Join(folder, noteName))
		var note gameNote
		if err != nil || json.Unmarshal(data, &note) != nil || note.Game.ID != filepath.Base(folder) {
			log.Printf("removing %s: a game's saves with no note", folder)
			_ = os.RemoveAll(folder)
			continue
		}
		game := note.Game
		game.Ended, game.endedAt, game.Players = true, time.Now(), 0
		game.collected, game.savePath, game.saveFolder, game.saveRoot = note.Collected, note.SavePath, note.SaveFolder, folder
		game.done = make(chan struct{})
		close(game.done)
		service.games[game.ID] = &game
		log.Printf("game %s (%s): ended before the service stopped, its save to be collected", game.ID, game.Title)
	}
}

func checksum(content []byte) string {
	sum := sha1.Sum(content)
	return hex.EncodeToString(sum[:])
}

func stopGameRequest(w http.ResponseWriter, r *http.Request) {
	game := findGame(r.PathValue("id"))
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	// A linked pair ends together
	partner := partnerOf(game)
	stopGame(game)
	if partner != nil {
		stopGame(partner)
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetUser stops a player's games and removes all the service keeps for them: their games' saves, memory sticks
// and save states. For an account deleted
func forgetUser(w http.ResponseWriter, r *http.Request) {
	user := r.PathValue("user")
	if !validPlayer.MatchString(user) {
		http.Error(w, "no such player", http.StatusNotFound)
		return
	}
	service.Lock()
	var running []*runningGame
	for _, game := range service.games {
		if game.StartedBy == user && !game.Ended {
			running = append(running, game)
		}
	}
	service.Unlock()
	var group sync.WaitGroup
	for _, game := range running {
		group.Go(func() { stopGame(game) })
	}
	group.Wait()
	service.Lock()
	for id, game := range service.games {
		if game.StartedBy == user && game.Ended {
			delete(service.games, id)
		}
	}
	service.Unlock()
	if err := os.RemoveAll(filepath.Join(envOr("SAVE_DIR", "/config/saves"), user)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("player %s: games stopped, saves and states removed", user)
	w.WriteHeader(http.StatusNoContent)
}

// consoleLink is one console's part in a linked pair: which console it is, the first console's id, which names the
// pair's sockets, and the other console's id
type consoleLink struct {
	console       int
	host, partner string
}

// env is what the console's process is given to find the other: the sockets for the DS's wireless packets
// (frontend.c) and for pausing, resuming and restarting together (commands.go), and a username of its own, which the
// emulator makes its wireless address from
func (link consoleLink) env() []string {
	other := 3 - link.console
	return []string{
		fmt.Sprintf("LINK_ID=%d", link.console-1), fmt.Sprintf("USERNAME=Player %d", link.console),
		"LINK_SELF=" + linkSocket(link.host, link.console, "wireless"), "LINK_PEER=" + linkSocket(link.host, other, "wireless"),
		"PARTNER_SELF=" + linkSocket(link.host, link.console, "control"), "PARTNER_PEER=" + linkSocket(link.host, other, "control"),
	}
}

// linkSocket is where a console of a linked pair, 1 or 2, takes the other's messages of a kind
func linkSocket(host string, console int, kind string) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("nas-link-%s-%d-%s.sock", host, console, kind))
}

// saveBeforeStopping keeps a save state of a game left idle, for whoever started it, as its pause menu's Save does:
// it's in Load when they start the game on the server again. The game's own save is kept as it ends. The state is
// one of the game's automatic ones, which don't take the place of the player's own
func saveBeforeStopping(game *runningGame, within time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), within)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+game.address+"/states?auto=1", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		log.Printf("game %s (%s): couldn't save before stopping: %v", game.ID, game.Title, err)
		return
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		log.Printf("game %s (%s): couldn't save before stopping: %s", game.ID, game.Title, response.Status)
		return
	}
	pruneStates(game.StartedBy)
}

// stopGame asks a game to end, and ends it if it doesn't within a few seconds. A game being started again ends
// instead: its restart sees it was asked to stop
func stopGame(game *runningGame) {
	// Its process as it is now: one started again has another
	service.Lock()
	game.stopRequested = true
	command, done := game.command, game.done
	service.Unlock()
	if command != nil && command.Process != nil {
		endProcess(command, done)
	}
}

// endProcess asks a game's process to end, keeping its save, and kills it if it hasn't within five seconds
func endProcess(command *exec.Cmd, done chan struct{}) {
	_ = command.Process.Signal(syscall.SIGTERM)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = command.Process.Kill()
		<-done
	}
}

// forward passes a request about a game's players on to the game itself
func forward(w http.ResponseWriter, r *http.Request, path string) {
	game := findGame(r.PathValue("id"))
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	// Saving a state waits for the frame loop, then for the emulator
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, r.Method, "http://"+game.address+path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	for _, header := range []string{"Content-Type", "Cache-Control"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func status(game *runningGame) (int, error) {
	reading, err := activityOf(game, "/status")
	return reading.Players, err
}

// activityOf is how a game stands (commands.go): its players, whether it's paused, and how long since anyone moved
// anything. Asked of /activity; a game that answers only /status has players alone
func activityOf(game *runningGame, path string) (activity, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+game.address+path, nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return activity{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return activity{}, errors.New(response.Status)
	}
	var reading activity
	err = json.NewDecoder(response.Body).Decode(&reading)
	return reading, err
}

// note takes in how a game stands, as of `now`. Under the service's lock
func (game *runningGame) note(reading activity, now time.Time) {
	game.Players, game.paused = reading.Players, reading.Paused
	game.lastInput = now.Add(-time.Duration(reading.InputIdle) * time.Second)
	if reading.Players > 0 {
		game.idleSince = now
	}
}

// idle is whether a game is idle at `now`: nobody in it for idleFor, or nobody in it moving anything for quietFor, or
// quietPausedFor while it stands paused. Under the service's lock
func (game *runningGame) idle(now time.Time) bool {
	if game.Players == 0 {
		return now.Sub(game.idleSince) > idleFor
	}
	quiet := quietFor
	if game.paused {
		quiet = quietPausedFor
	}
	return now.Sub(game.lastInput) > quiet
}

// shouldStop is whether a game is to be stopped for being idle. A linked pair stops only once both consoles are idle,
// and not while one starts again. Under the service's lock
func shouldStop(game, partner *runningGame, now time.Time) bool {
	if game.Ended || game.stopping || game.restarting || !game.idle(now) {
		return false
	}
	if game.LinkedWith != "" && partner != nil && !partner.Ended {
		return !partner.restarting && partner.idle(now)
	}
	return true
}

// watchGames keeps each game's player count, stops a game that has been idle for a while, and forgets ended games
// with nothing left to collect
func watchGames() {
	for range time.Tick(15 * time.Second) {
		checkGames()
		sweepEnded()
	}
}

// checkGames looks at every game first, and then decides which to stop, so a linked pair is decided on both
// consoles as they are now
func checkGames() {
	service.Lock()
	games := make([]*runningGame, 0, len(service.games))
	for _, game := range service.games {
		if !game.Ended && !game.restarting {
			games = append(games, game)
		}
	}
	service.Unlock()
	readings := map[*runningGame]activity{}
	for _, game := range games {
		if reading, err := activityOf(game, "/activity"); err == nil {
			readings[game] = reading
		}
	}
	now := time.Now()
	var stops []*runningGame
	service.Lock()
	for game, reading := range readings {
		if !game.Ended && !game.restarting {
			game.note(reading, now)
		}
	}
	for game := range readings {
		if shouldStop(game, service.games[game.LinkedWith], now) {
			game.stopping = true
			stops = append(stops, game)
		}
	}
	service.Unlock()
	for _, game := range stops {
		go idleStop(game)
	}
}

// idleStop saves and stops a game left idle; unless a player came back while it was being saved
func idleStop(game *runningGame) {
	log.Printf("game %s (%s): idle, stopping", game.ID, game.Title)
	if game.LinkedWith == "" {
		saveBeforeStopping(game, 25*time.Second)
	}
	if reading, err := activityOf(game, "/activity"); err == nil {
		now := time.Now()
		service.Lock()
		back := !game.Ended && !game.restarting
		if back {
			game.note(reading, now)
			back = !game.idle(now)
		}
		if back {
			game.stopping = false
		}
		service.Unlock()
		if back {
			log.Printf("game %s (%s): a player is back, not stopping", game.ID, game.Title)
			return
		}
	}
	stopGame(game)
}

// sweepEnded forgets ended games kept past keepEnded whose saves have nothing left to collect, or are no one's.
// One whose save waits is kept, however long, and the log says so once
func sweepEnded() {
	service.Lock()
	var old []*runningGame
	for _, game := range service.games {
		if game.Ended && time.Since(game.endedAt) > keepEnded {
			old = append(old, game)
		}
	}
	service.Unlock()
	for _, game := range old {
		service.Lock()
		path, folder := game.savePath, game.saveFolder
		_, kept := ownerOf(game)
		service.Unlock()
		content, err := readSave(path, folder)
		if err != nil {
			continue
		}
		if !kept {
			content = nil
		}
		if !forgetEnded(game, content) {
			service.Lock()
			tell := !game.toldWaiting
			game.toldWaiting = true
			service.Unlock()
			if tell {
				log.Printf("game %s (%s): its save has waited %v to be collected, and is kept until it is", game.ID,
					game.Title, time.Since(game.endedAt).Round(time.Minute))
			}
		}
	}
}

// pruneStates lets the oldest save states go, the player's own and others', while the player's take more than
// statesPerPlayer, or everyone's more than statesInAll
func pruneStates(user string) {
	saves := envOr("SAVE_DIR", "/config/saves")
	if validPlayer.MatchString(user) {
		pruneStatesIn([]string{filepath.Join(saves, user, "states")}, statesPerPlayer)
	}
	everyone, _ := filepath.Glob(filepath.Join(saves, "*", "states"))
	pruneStatesIn(everyone, statesInAll)
}

// pruneStatesIn lets the oldest save states in folders go, each with its picture, until they take no more than budget
func pruneStatesIn(folders []string, budget int64) {
	type state struct {
		path     string
		size     int64
		modified time.Time
	}
	var states []state
	var total int64
	for _, folder := range folders {
		_ = filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
			if err != nil || !entry.Type().IsRegular() || !strings.Contains(entry.Name(), ".state") {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return nil
			}
			states = append(states, state{path: path, size: info.Size(), modified: info.ModTime()})
			total += info.Size()
			return nil
		})
	}
	sort.Slice(states, func(a, b int) bool { return states[a].modified.Before(states[b].modified) })
	for _, old := range states {
		if total <= budget {
			return
		}
		id := strings.SplitN(filepath.Base(old.path), ".", 2)[0]
		_ = os.Remove(old.path)
		_ = os.Remove(filepath.Join(filepath.Dir(old.path), id+".jpg"))
		total -= old.size
	}
}

type prefixed struct {
	prefix string
	out    io.Writer
}

func (p *prefixed) Write(data []byte) (int, error) {
	for _, line := range bytes.SplitAfter(data, []byte("\n")) {
		if len(line) > 0 {
			_, _ = p.out.Write(append([]byte(p.prefix), line...))
		}
	}
	return len(data), nil
}

func writeJSONTo(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}

func envInt(name string, fallback int) int {
	if value, err := strconv.Atoi(os.Getenv(name)); err == nil && value > 0 {
		return value
	}
	return fallback
}

type namedFile struct {
	Content []byte `json:"content"`
	Name    string `json:"name"`
}

type discFile struct {
	File     string `json:"file"`
	FileName string `json:"fileName"`
}

// A file name as given, if it's only a name: no folders, nothing hidden
func plainName(name string) (string, bool) {
	base := filepath.Base(name)
	return base, base == name && base != "." && base != ".." && !strings.HasPrefix(base, ".") && base != ""
}

// prepareGame lays out a game for its emulator in workDir, as the browser does in its own: the game's file under its
// own name (a link to the library's copy), every disc and a list of them for a game on several, and the player's BIOS
// files in a system folder of the game's own, with the emulators' support files. The BIOS files also sit beside the
// game, where arcade emulators look for theirs. It answers with the file to start and the system folder
func prepareGame(workDir, gamePath, romsDir, fileName string, bioses []namedFile, discs []discFile) (string, string, error) {
	gameDir := filepath.Join(workDir, "game")
	systemDir := filepath.Join(workDir, "system")
	for _, dir := range []string{gameDir, systemDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", "", err
		}
	}
	// The emulators' own support files, such as PPSSPP's
	shared, _ := os.ReadDir(envOr("SYSTEM_SOURCE", "/system"))
	for _, entry := range shared {
		_ = os.Symlink(filepath.Join(envOr("SYSTEM_SOURCE", "/system"), entry.Name()), filepath.Join(systemDir, entry.Name()))
	}
	for _, bios := range bioses {
		name, ok := plainName(bios.Name)
		if !ok {
			continue
		}
		for _, dir := range []string{systemDir, gameDir} {
			_ = os.Remove(filepath.Join(dir, name))
			if err := os.WriteFile(filepath.Join(dir, name), bios.Content, 0o644); err != nil {
				return "", "", err
			}
		}
	}

	name, ok := plainName(fileName)
	if !ok {
		name = filepath.Base(gamePath)
	}
	launch := filepath.Join(gameDir, name)
	if err := os.Symlink(gamePath, launch); err != nil {
		return "", "", err
	}
	if len(discs) > 1 {
		var list strings.Builder
		for _, disc := range discs {
			discName, ok := plainName(disc.FileName)
			discPath := filepath.Join(romsDir, filepath.Clean("/"+disc.File))
			if _, err := os.Stat(discPath); !ok || err != nil {
				return "", "", errors.New("a disc of the game is missing")
			}
			if discName != name {
				if err := os.Symlink(discPath, filepath.Join(gameDir, discName)); err != nil {
					return "", "", err
				}
			}
			list.WriteString(discName + "\n")
		}
		launch = filepath.Join(gameDir, strings.TrimSuffix(name, filepath.Ext(name))+".m3u")
		if err := os.WriteFile(launch, []byte(list.String()), 0o644); err != nil {
			return "", "", err
		}
	}
	return launch, systemDir, nil
}
