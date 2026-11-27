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
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The game service: what the app asks to run a game on the NAS, list the games running, and bring a player into one.
// Each game is this same program run again on its own (main.go), with a UDP port of its own for players' pictures and
// sound. The app is the only caller, and proves it with a key both are given.
//
//	POST   /games                        {platform, core, file, title, controls, startedBy, libraryOwner, rom, save}
//	                                     -> the game
//	GET    /games                        -> the games running; with ?all=1, those ended in the last hour too
//	GET    /games/{id}/save              -> the game's own save, if it has one not yet collected
//	GET    /games/{id}/states            -> its save states, kept for the player who started it, newest first
//	POST   /games/{id}/states            -> a new one
//	GET    /games/{id}/states/{state}/picture
//	POST   /games/{id}/states/{state}/load
//	POST   /games/{id}/save/collected    {sha1}
//	GET    /cores                        -> the emulators it has, by name
//	DELETE /games/{id}
//	POST   /games/{id}/players           -> {player, offer}
//	POST   /games/{id}/players/{n}/answer {answer}

type runningGame struct {
	Controls string `json:"controls"`
	Core     string `json:"core"`
	// Whether the game has ended. An ended game is kept for an hour, until its last save is collected
	Ended bool   `json:"ended"`
	ID    string `json:"id"`
	// Whose library the game is in, and its id there, for its save to be kept with the player's others
	LibraryOwner string    `json:"libraryOwner"`
	Platform     string    `json:"platform"`
	Players      int       `json:"players"`
	Rom          string    `json:"rom"`
	Started      time.Time `json:"started"`
	StartedBy    string    `json:"startedBy"`
	Title        string    `json:"title"`

	address string
	command *exec.Cmd
	// The checksum of the save last collected, or given at the start
	collected string
	done      chan struct{}
	endedAt   time.Time
	idleSince time.Time
	port      int
	// Where the game keeps its own save
	savePath string
}

var service = struct {
	sync.Mutex
	games map[string]*runningGame
}{games: map[string]*runningGame{}}

var (
	errFull     = errors.New("the NAS is running as many games as it may")
	errNoCore   = errors.New("that emulator isn't on the NAS")
	errNoGame   = errors.New("no such game")
	errBadFile  = errors.New("no such game file")
	validCore   = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
	validPlayer = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	// How long an ended game's last save waits to be collected
	keepEnded   = time.Hour
	idAlphabet  = "abcdefghjkmnpqrstuvwxyz23456789"
	firstPort   = 47900
	gameSlots   = 3
	idleFor     = 5 * time.Minute
	readyWithin = 30 * time.Second
)

func serve() {
	key := os.Getenv("SERVICE_KEY")
	if len(key) < 32 {
		log.Fatal("SERVICE_KEY must be set, at least 32 characters")
	}
	firstPort = envInt("FIRST_MEDIA_PORT", firstPort)
	gameSlots = envInt("MAX_GAMES", gameSlots)
	idleFor = time.Duration(envInt("IDLE_MINUTES", 5)) * time.Minute

	mux := http.NewServeMux()
	mux.HandleFunc("POST /games", startGame)
	mux.HandleFunc("GET /games", listGames)
	mux.HandleFunc("GET /cores", listCores)
	mux.HandleFunc("DELETE /games/{id}", stopGameRequest)
	mux.HandleFunc("GET /games/{id}/save", gameSave)
	mux.HandleFunc("POST /games/{id}/save/collected", saveCollected)
	mux.HandleFunc("POST /games/{id}/players", func(w http.ResponseWriter, r *http.Request) {
		forward(w, r, "/players")
	})
	mux.HandleFunc("POST /games/{id}/players/{player}/answer", func(w http.ResponseWriter, r *http.Request) {
		forward(w, r, "/players/"+r.PathValue("player")+"/answer")
	})
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		mux.HandleFunc(method+" /games/{id}/states", func(w http.ResponseWriter, r *http.Request) {
			forward(w, r, "/states")
		})
	}
	mux.HandleFunc("GET /games/{id}/states/{state}/picture", func(w http.ResponseWriter, r *http.Request) {
		forward(w, r, "/states/"+r.PathValue("state")+"/picture")
	})
	mux.HandleFunc("POST /games/{id}/states/{state}/load", func(w http.ResponseWriter, r *http.Request) {
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
	check(http.ListenAndServe(address, keyed))
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

func startGame(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Controls     string            `json:"controls"`
		Core         string            `json:"core"`
		File         string            `json:"file"`
		LibraryOwner string            `json:"libraryOwner"`
		Options      map[string]string `json:"options"`
		Platform     string            `json:"platform"`
		Rom          string            `json:"rom"`
		// The player's latest save of the game, which it starts with: as bytes, so base64 in JSON
		Save      []byte `json:"save"`
		StartedBy string `json:"startedBy"`
		Title     string `json:"title"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	corePath := filepath.Join("/cores", request.Core+"_libretro.so")
	if !validCore.MatchString(request.Core) {
		http.Error(w, errNoCore.Error(), http.StatusBadRequest)
		return
	}
	if _, err := os.Stat(corePath); err != nil {
		http.Error(w, errNoCore.Error(), http.StatusNotFound)
		return
	}
	// Only files in the games folder: a path that leaves it is refused
	romsDir := envOr("ROMS_DIR", "/roms")
	gamePath := filepath.Join(romsDir, filepath.Clean("/"+request.File))
	if info, err := os.Stat(gamePath); err != nil || info.IsDir() {
		http.Error(w, errBadFile.Error(), http.StatusNotFound)
		return
	}
	// Each player's saves in a folder of their own: the game's own save, which is the app's latest when it starts, and
	// a PSP's memory stick, which stays here
	if !validPlayer.MatchString(request.StartedBy) {
		http.Error(w, "no such player", http.StatusBadRequest)
		return
	}
	saveDir := filepath.Join(envOr("SAVE_DIR", "/config/saves"), request.StartedBy)
	savePath := filepath.Join(saveDir, strings.TrimSuffix(filepath.Base(gamePath), filepath.Ext(gamePath))+".srm")
	if err := os.MkdirAll(saveDir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	collected := ""
	if len(request.Save) > 0 {
		if err := os.WriteFile(savePath, request.Save, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		collected = checksum(request.Save)
	} else {
		// A save left from before is the app's to give, not this folder's
		_ = os.Remove(savePath)
	}
	var options []string
	for key, value := range request.Options {
		if strings.ContainsAny(key+value, ";=\n") {
			continue
		}
		options = append(options, key+"="+value)
	}

	service.Lock()
	port := -1
	for slot := range gameSlots {
		taken := false
		for _, game := range service.games {
			taken = taken || (!game.Ended && game.port == firstPort+slot)
		}
		if !taken {
			port = firstPort + slot
			break
		}
	}
	if port < 0 {
		service.Unlock()
		http.Error(w, errFull.Error(), http.StatusServiceUnavailable)
		return
	}
	game := &runningGame{
		Controls: request.Controls, Core: request.Core, ID: newID(), LibraryOwner: request.LibraryOwner,
		Platform: request.Platform, Rom: request.Rom, Started: time.Now(), StartedBy: request.StartedBy,
		Title: request.Title, collected: collected, savePath: savePath,
		address: fmt.Sprintf("127.0.0.1:%d", port+1000), done: make(chan struct{}), idleSince: time.Now(), port: port,
	}
	self, _ := os.Executable()
	command := exec.Command(self)
	command.Env = append(os.Environ(),
		"GAME="+gamePath, "CORE_PATH="+corePath, "CORE_OPTIONS="+strings.Join(options, ";"),
		"HTTP_ADDRESS="+game.address, "MEDIA_PORT="+strconv.Itoa(port), "SAVE_DIR="+saveDir,
		"STATES_DIR="+filepath.Join(saveDir, "states", strings.TrimSuffix(filepath.Base(gamePath), filepath.Ext(gamePath))))
	prefix := fmt.Sprintf("[%s] ", game.ID)
	command.Stdout = &prefixed{prefix: prefix, out: os.Stdout}
	command.Stderr = &prefixed{prefix: prefix, out: os.Stderr}
	game.command = command
	if err := command.Start(); err != nil {
		service.Unlock()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	service.games[game.ID] = game
	service.Unlock()
	go func() {
		_ = command.Wait()
		close(game.done)
		service.Lock()
		game.Ended, game.endedAt, game.Players = true, time.Now(), 0
		service.Unlock()
		log.Printf("game %s (%s) ended", game.ID, game.Title)
	}()

	// Ready once it answers; a game that never does is stopped
	ready := false
	for deadline := time.Now().Add(readyWithin); time.Now().Before(deadline) && !ready; {
		select {
		case <-game.done:
			http.Error(w, "the game stopped as it started", http.StatusInternalServerError)
			return
		case <-time.After(250 * time.Millisecond):
		}
		_, err := status(game)
		ready = err == nil
	}
	if !ready {
		stopGame(game)
		http.Error(w, "the game didn't start in time", http.StatusGatewayTimeout)
		return
	}
	log.Printf("game %s started: %s, %s, port %d", game.ID, game.Title, request.Core, port)
	writeJSONTo(w, http.StatusOK, game)
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

// findGame is a game still running
func findGame(id string) *runningGame {
	service.Lock()
	defer service.Unlock()
	if game := service.games[id]; game != nil && !game.Ended {
		return game
	}
	return nil
}

// The game's own save, as the game last kept it, when it isn't the one collected last. A game keeps its save every
// few seconds while it runs, and as it ends
func gameSave(w http.ResponseWriter, r *http.Request) {
	service.Lock()
	game := service.games[r.PathValue("id")]
	var path, collected string
	if game != nil {
		path, collected = game.savePath, game.collected
	}
	service.Unlock()
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	content, err := os.ReadFile(path)
	if err != nil || len(content) == 0 || checksum(content) == collected {
		// Nothing new: an ended game has nothing left to give, and is forgotten
		service.Lock()
		if game.Ended {
			delete(service.games, game.ID)
		}
		service.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Save-Sha1", checksum(content))
	_, _ = w.Write(content)
}

// saveCollected is told the app has kept the game's save; an ended game is then forgotten
func saveCollected(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Sha1 string `json:"sha1"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	service.Lock()
	defer service.Unlock()
	game := service.games[r.PathValue("id")]
	if game == nil {
		http.Error(w, errNoGame.Error(), http.StatusNotFound)
		return
	}
	game.collected = body.Sha1
	if game.Ended {
		delete(service.games, game.ID)
	}
	w.WriteHeader(http.StatusNoContent)
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
	stopGame(game)
	w.WriteHeader(http.StatusNoContent)
}

// stopGame asks a game to end, and ends it if it doesn't within a few seconds
func stopGame(game *runningGame) {
	_ = game.command.Process.Signal(syscall.SIGTERM)
	select {
	case <-game.done:
	case <-time.After(5 * time.Second):
		_ = game.command.Process.Kill()
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
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+game.address+"/status", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	var body struct {
		Players int `json:"players"`
	}
	err = json.NewDecoder(response.Body).Decode(&body)
	return body.Players, err
}

// watchGames keeps each game's player count, and stops a game nobody has been in for a while
func watchGames() {
	for range time.Tick(15 * time.Second) {
		service.Lock()
		games := make([]*runningGame, 0, len(service.games))
		for id, game := range service.games {
			if game.Ended {
				if time.Since(game.endedAt) > keepEnded {
					delete(service.games, id)
				}
				continue
			}
			games = append(games, game)
		}
		service.Unlock()
		for _, game := range games {
			count, err := status(game)
			if err != nil {
				continue
			}
			service.Lock()
			game.Players = count
			if count > 0 {
				game.idleSince = time.Now()
			}
			idle := time.Since(game.idleSince)
			service.Unlock()
			if idle > idleFor {
				log.Printf("game %s (%s): nobody in it for %v, stopping", game.ID, game.Title, idle.Round(time.Second))
				go stopGame(game)
			}
		}
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
