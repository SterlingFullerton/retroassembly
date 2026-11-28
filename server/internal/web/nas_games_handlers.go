package web

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/nasgames"
	"retroassembly/server/internal/preference"
	"retroassembly/server/internal/together"
)

// Games run on the NAS, for players whose own device can't run them (see the nasgames package). Players join one
// through play together's invitations, under a code of its own: a zero and the game's id. A zero is never in a
// code a person's game is given, so the two can't be confused. Players are told of "the server", and what goes wrong
// is answered with a code (failure.Coded) the browser puts in their language

const nasCodePrefix = "0"

// How long the list of games being shared waits for the NAS before going without its games
const nasListWait = 3 * time.Second

// How long a player's place in a game waits for their answer: as long as the service holds it
const nasAnswerWithin = 30 * time.Second

// How many places in one game a player may have waiting for an answer at once: one for each of two devices. Each holds
// one of the game's four players until it's answered or given back
const nasPlacesWaiting = 2

// How long after joining a game a player may still save and load its states
const nasJoinedFor = 12 * time.Hour

var (
	errNASGameNotFound = failure.Coded(http.StatusNotFound, nasgames.CodeNotFound, "No game to join by that code")
	errNASNotYours     = failure.Coded(http.StatusForbidden, "server_not_yours",
		"Only whoever started a game on the server can stop it")
	errNASNoPlace       = failure.Coded(http.StatusGone, nasgames.CodePlaceGone, "Ask to join again")
	errNASPlacesWaiting = failure.Coded(http.StatusTooManyRequests, "server_places_waiting",
		"Wait a moment, then join again")
	errNASStatesNotYours = failure.Coded(http.StatusForbidden, "server_states_not_yours",
		"Only players in the game can save or load its states")
	errNASOneGame = failure.Coded(http.StatusConflict, "server_one_game",
		"You already have a game on the server. Stop it first")
	errNASStarting       = failure.Coded(http.StatusTooManyRequests, "server_starting", "Your game is starting on the server")
	errNASSaveUnreadable = failure.Coded(http.StatusInternalServerError, "server_save_missing",
		"Your latest save of the game couldn't be read")
	errNASSaveWaiting = failure.Coded(http.StatusServiceUnavailable, "server_save_waiting",
		"Your last save on the server is still being kept. Try again in a moment")
	errNASNotInFolder = failure.Coded(http.StatusBadRequest, "server_not_in_games_folder",
		"That game's file isn't in the games folder")
)

// nasState is what the app keeps of the games on the NAS between requests
type nasState struct {
	// Players' places in games, waiting for their answer, by a token of their own (nasPlace)
	places sync.Map
	// When each player joined each game, by the game's id and the player's ("id|user"): who may save and load its states
	joined sync.Map
	// The players whose start of a game is under way
	starting sync.Map
	// The friends' consoles of linked pairs given their player's save, or being given it
	giving sync.Map
	// The games whose saves can't be kept, by id: not asked for them again
	unkept sync.Map
	// The last failure logged keeping each game's save, by id: logged again only when it changes
	failing sync.Map
	// The settings each emulator may be given in a game on the NAS, and the values each may have
	coreOptions map[string]map[string][]string
	// What the service has, as last asked (see nasInfo)
	info struct {
		sync.Mutex
		at, failedAt time.Time
		cores        []string
		version      nasgames.Version
		// Whether the service has ever answered
		known bool
		// Closed when the service has answered a question under way
		asking chan struct{}
	}
}

// nasPlace is a player's place in a game, waiting for their answer
type nasPlace struct {
	game   string
	made   time.Time
	player int
	user   string
}

func nasCode(id string) string { return nasCodePrefix + strings.ToUpper(id) }

// nasGameID is the id of the NAS game a code joins, and whether the code is one
func nasGameID(code string) (string, bool) {
	rest, found := strings.CutPrefix(strings.ToUpper(strings.TrimSpace(code)), nasCodePrefix)
	return strings.ToLower(rest), found && rest != ""
}

func (s *Server) nasGame(ctx context.Context, id string) (nasgames.Game, error) {
	games, err := s.nasGames.List(ctx)
	if err != nil {
		return nasgames.Game{}, err
	}
	for _, game := range games {
		if game.ID == id {
			return game, nil
		}
	}
	return nasgames.Game{}, errNASGameNotFound
}

// nasListings are the games running on the NAS, as the list of games being shared shows them. None when the NAS
// isn't set up or doesn't answer in time: the people's games are listed anyway
func (s *Server) nasListings(ctx context.Context) []together.Listing {
	if s.nasGames == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, nasListWait)
	defer cancel()
	games, err := s.nasGames.List(ctx)
	if err != nil {
		return nil
	}
	listings := make([]together.Listing, 0, len(games))
	for _, game := range games {
		// A linked pair isn't listed: the starter's console is joined from the game's page, and the friend's only with
		// the code its starter gives them, as whoever joins it first is given their own save in it
		if game.LinkedWith != "" {
			continue
		}
		listings = append(listings, together.Listing{
			Code: nasCode(game.ID), Controls: game.Controls, Host: s.nasStarter(ctx, game), Title: game.Title,
		})
	}
	return listings
}

// nasStarter is who a game on the NAS is shown as hosted by: the username of the player who started it, so that
// games of the same title are told apart. "Server" for one whose player can't be found
func (s *Server) nasStarter(ctx context.Context, game nasgames.Game) string {
	var username string
	err := s.database.QueryRowContext(ctx, `SELECT username FROM users WHERE id = ? AND status = ? LIMIT 1`,
		game.StartedBy, db.StatusNormal).Scan(&username)
	if err != nil || username == "" {
		return "Server"
	}
	return username
}

// nasPlacesOf is how many places in a game a player has waiting for their answer. Places no longer waiting are let go
func (s *Server) nasPlacesOf(game, user string) int {
	count := 0
	s.nas.places.Range(func(key, value any) bool {
		place, _ := value.(nasPlace)
		if time.Since(place.made) > nasAnswerWithin {
			s.nas.places.Delete(key)
		} else if place.game == game && place.user == user {
			count++
		}
		return true
	})
	return count
}

// newestNASPlace is the token of a player's newest place waiting in a game, for an answer from a browser that doesn't
// send the token it was given
func (s *Server) newestNASPlace(game, user string) string {
	var token string
	var newest time.Time
	s.nas.places.Range(func(key, value any) bool {
		place, _ := value.(nasPlace)
		if place.game == game && place.user == user && place.made.After(newest) {
			token, newest = key.(string), place.made
		}
		return true
	})
	return token
}

func newNASPlaceToken() string {
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	return hex.EncodeToString(random)
}

// findNASInvitation keeps a place in the game for the player asking, and gives them its offer, as a person's
// invitation would, with a token their answer is sent with: two devices of one player each answer for their own place
func (s *Server) findNASInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope, _, id string) {
	game, err := s.nasGame(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	if s.nasPlacesOf(id, scope.User.ID) >= nasPlacesWaiting {
		writeError(w, errNASPlacesWaiting)
		return
	}
	if game.Console == 2 && game.KeepFor == nil && scope.User.ID != game.StartedBy {
		s.giveFriendSave(context.WithoutCancel(r.Context()), scope, game)
	}
	player, offer, err := s.nasGames.Offer(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	token := newNASPlaceToken()
	s.nas.places.Store(token, nasPlace{game: id, made: time.Now(), player: player, user: scope.User.ID})
	log.Printf("nas games: player %d's place in %s kept for user %s", player, id, scope.User.ID)
	invitation := together.Invitation{
		Controls: game.Controls, Core: game.Core, Host: s.nasStarter(r.Context(), game), Linked: game.LinkedWith != "",
		Offer: offer, Platform: game.Platform, StartedHere: game.StartedBy == scope.User.ID, Title: game.Title,
	}
	if game.Console == 1 && game.LinkedWith != "" {
		invitation.FriendCode = nasCode(game.LinkedWith)
	}
	writeJSON(w, http.StatusOK, struct {
		together.Invitation
		// What the player's answer is sent with
		Place string `json:"place"`
	}{invitation, token})
}

// giveFriendSave gives the friend joining a linked game's second console their own save of the game, from the copy
// in their library, and has it kept for them. A friend without the game in their library plays from a blank save, which
// isn't kept: for Download Play, a game on one console is enough. It's given once, to whoever joins the console first:
// the service turns away a console given one already, or being started again with it
func (s *Server) giveFriendSave(ctx context.Context, scope library.Scope, game nasgames.Game) {
	if _, given := s.nas.giving.LoadOrStore(game.ID, true); given {
		return
	}
	var fileID, fileName, platform string
	err := s.database.QueryRowContext(ctx, `SELECT file_id, file_name, platform FROM roms WHERE user_id = ? AND id = ? LIMIT 1`,
		game.LibraryOwner, game.Rom).Scan(&fileID, &fileName, &platform)
	if err != nil {
		return
	}
	// Their copy: the same file in the games folder, or one by the same name
	var rom string
	err = scope.Database.QueryRowContext(ctx,
		`SELECT id FROM roms WHERE user_id = ? AND status = ? AND platform = ? AND (file_id = ? OR file_name = ?)
		ORDER BY file_id = ? DESC LIMIT 1`,
		scope.LibraryOwnerID, db.StatusNormal, platform, fileID, fileName, fileID).Scan(&rom)
	if err != nil {
		return
	}
	// A save that can't be read isn't given as a blank one, which would become their newest
	save, err := s.linkedStartSave(ctx, scope, rom)
	if err != nil {
		log.Printf("nas games: giving %s its friend's save: %v", game.ID, err)
		s.nas.giving.Delete(game.ID)
		return
	}
	keepFor := nasgames.KeepFor{LibraryOwner: scope.LibraryOwnerID, Rom: rom, User: scope.User.ID}
	err = s.nasGames.GiveSave(ctx, game.ID, save, keepFor)
	var refused *failure.Error
	if errors.As(err, &refused) && refused.Status == http.StatusConflict {
		return
	}
	if err != nil {
		log.Printf("nas games: giving %s its friend's save: %v", game.ID, err)
		s.nas.giving.Delete(game.ID)
		return
	}
	log.Printf("nas games: %s given the save of user %s", game.ID, scope.User.ID)
}

// answerNASInvitation passes a player's answer to the place they were given, by its token. A browser that sends none
// answers for the player's newest place in the game
func (s *Server) answerNASInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope, id, token,
	answer string) {
	if token == "" {
		token = s.newestNASPlace(id, scope.User.ID)
	}
	value, found := s.nas.places.LoadAndDelete(token)
	place, ok := value.(nasPlace)
	if !found || !ok || place.game != id || place.user != scope.User.ID || time.Since(place.made) > nasAnswerWithin {
		writeError(w, errNASNoPlace)
		return
	}
	if err := s.nasGames.Answer(r.Context(), id, place.player, answer); err != nil {
		writeError(w, err)
		return
	}
	s.nas.joined.Store(id+"|"+scope.User.ID, time.Now())
	log.Printf("nas games: user %s answered for player %d in %s", scope.User.ID, place.player, id)
	writeJSON(w, http.StatusOK, true)
}

// How long what the service has is known for, once it has answered, and how long it's not asked again after it didn't
const (
	nasInfoFor       = time.Minute
	nasInfoFailedFor = 5 * time.Second
)

// nasInfo is what the service has: its emulators, its version, and whether it has ever answered. Asked for at most once
// a minute, as it changes only when the service's image does, by one request at a time. When it doesn't answer, what
// it last said is kept, and it's asked again a few seconds later
func (s *Server) nasInfo(ctx context.Context) ([]string, nasgames.Version, bool) {
	info := &s.nas.info
	info.Lock()
	if info.known && time.Since(info.at) < nasInfoFor || time.Since(info.failedAt) < nasInfoFailedFor {
		defer info.Unlock()
		return info.cores, info.version, info.known
	}
	asking := info.asking
	if asking == nil {
		info.asking = make(chan struct{})
	}
	info.Unlock()
	if asking != nil {
		select {
		case <-asking:
		case <-ctx.Done():
		}
		info.Lock()
		defer info.Unlock()
		return info.cores, info.version, info.known
	}

	asked, cancel := context.WithTimeout(context.WithoutCancel(ctx), nasListWait)
	defer cancel()
	cores, err := s.nasGames.Cores(asked)
	var version nasgames.Version
	if err == nil {
		version, err = s.nasGames.Version(asked)
	}
	info.Lock()
	defer info.Unlock()
	if err == nil {
		if !version.Speaks() && (!info.known || info.version.API != version.API) {
			log.Printf("nas games: the game service speaks version %d of its API and the app %d: games on the server "+
				"are off until both are updated", version.API, nasgames.APIVersion)
		}
		info.cores, info.version, info.at, info.known = cores, version, time.Now(), true
	} else {
		info.failedAt = time.Now()
	}
	close(info.asking)
	info.asking = nil
	return info.cores, info.version, info.known
}

// nasCores is the emulators the NAS has, which decide where Play on the NAS is offered: none when it isn't set up,
// has never answered, or speaks another version of its API than the app. The emulator a linked game is played with
// only when the service starts linked games
func (s *Server) nasCores(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	if s.nasGames == nil {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	cores, version, known := s.nasInfo(r.Context())
	offered := []string{}
	if known && version.Speaks() {
		for _, core := range cores {
			if core != linkedCore || version.Can(nasgames.CapabilityLinked) {
				offered = append(offered, core)
			}
		}
	}
	writeJSON(w, http.StatusOK, offered)
}

// A linked DS game runs two consoles of melonDS DS, whose wireless the service links: the starter's and a friend's
const linkedCore = "melondsds"

// melonDS DS's settings for a linked console: each console's wireless address made from its player's name, so the two
// tell each other apart; drawn by the processor, as the service has no screen; a DS, not a DSi; and no pointer dot
// on the touch screen, which the player's own pointer is
var linkedOptions = map[string]string{
	"melonds_console_mode":     "ds",
	"melonds_mac_address_mode": "from-username",
	"melonds_render_mode":      "software",
	"melonds_show_cursor":      "disabled",
}

// The settings an emulator always has on the NAS, whatever the player's, so that one game can't take what the others
// need: the console's own resolution, or close to it, and the usual renderer and processor emulation. N64 games are
// emulated by the dynamic recompiler, which the browser doesn't have
var serverCoreOptions = map[string]map[string]string{
	"desmume":     {"desmume_internal_resolution": "256x192"},
	"desmume2015": {"desmume_internal_resolution": "256x192"},
	"mame2003_plus": {
		"mame2003-plus_art_resolution":    "1",
		"mame2003-plus_vector_resolution": "640x480",
	},
	"mupen64plus_next": {
		"mupen64plus-169screensize":          "960x540",
		"mupen64plus-43screensize":           "640x480",
		"mupen64plus-EnableNativeResFactor":  "0",
		"mupen64plus-MultiSampling":          "0",
		"mupen64plus-cpucore":                "dynamic_recompiler",
		"mupen64plus-parallel-rdp-upscaling": "1x",
		"mupen64plus-rdp-plugin":             "gliden64",
		"mupen64plus-rsp-plugin":             "hle",
		"mupen64plus-txEnhancementMode":      "None",
	},
	"pcsx_rearmed": {
		"pcsx_rearmed_neon_enhancement_enable": "disabled",
		"pcsx_rearmed_scale_hires":             "disabled",
	},
}

// The emulator, and kind of file, whose saves a linked game starts from and keeps its starter's save as: melonDS's
// plain .sav, the same as melonDS DS's own
const (
	linkedSaveCore = "melonds"
	linkedSaveType = "sav"
)

// The DS emulators whose saves are DeSmuME's .dsv: melonDS's plain save, with a footer of DeSmuME's own
var desmumeCores = map[string]bool{"desmume": true, "desmume2015": true}

// errNotLinkable is a linked game asked for of a console that has no wireless to link
var errNotLinkable = failure.Coded(http.StatusBadRequest, "server_not_linkable",
	"Only DS games can be played with a friend on the server")

// startNASGame runs a game from the library on the NAS, with the emulator the player has chosen for its console and
// the on-screen controls their browser shows for it. It answers with the code that joins it. With "linked", a DS game
// runs as two linked consoles, and the answer has the friend's code too. A player has one game on the NAS at a time,
// or one linked pair, and starts one at a time
func (s *Server) startNASGame(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if s.nasGames == nil {
		writeError(w, nasgames.ErrOff)
		return
	}
	body, ok := readJSON(w, r)
	if !ok {
		return
	}
	object, _ := body.(preference.Object)
	var check validation
	romValue, romPresent := object["rom"]
	coreValue, corePresent := object["core"]
	controlsValue, controlsPresent := object["controls"]
	saveTypeValue, saveTypePresent := object["saveFileType"]
	romID := check.String("rom", romValue, romPresent, 1)
	core := check.String("core", coreValue, corePresent, 1)
	controls := check.String("controls", controlsValue, controlsPresent, 0)
	saveType, _ := check.OptionalString("saveFileType", saveTypeValue, saveTypePresent, 0, 8)
	if check.Failed(w) {
		return
	}
	linked, isBool := object["linked"].(bool)
	if _, present := object["linked"]; present && !isBool {
		writeError(w, failure.New(http.StatusBadRequest, "linked must be true or false"))
		return
	}
	if linked {
		core, saveType = linkedCore, ""
	}
	if _, version, _ := s.nasInfo(r.Context()); !version.Speaks() ||
		linked && !version.Can(nasgames.CapabilityLinked) {
		writeError(w, nasgames.ErrOutOfDate)
		return
	}
	if _, busy := s.nas.starting.LoadOrStore(scope.User.ID, true); busy {
		writeError(w, errNASStarting)
		return
	}
	defer s.nas.starting.Delete(scope.User.ID)
	var fileID, fileName, platform, title string
	var discGroup sql.NullString
	err := scope.Database.QueryRowContext(r.Context(),
		`SELECT file_id, file_name, platform, COALESCE(NULLIF(game_title, ''), NULLIF(game_name, ''), file_name),
		disc_group FROM roms WHERE user_id = ? AND status = ? AND id = ? LIMIT 1`,
		scope.LibraryOwnerID, db.StatusNormal, romID,
	).Scan(&fileID, &fileName, &platform, &title, &discGroup)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, failure.New(http.StatusNotFound, "ROM not found"))
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	if linked && platform != "nds" {
		writeError(w, errNotLinkable)
		return
	}
	// The service has the same games folder: a game's file is found there by its path inside it
	file, isGame := strings.CutPrefix(fileID, "roms/")
	if !isGame {
		writeError(w, errNASNotInFolder)
		return
	}
	// Once asked, the game is started even if the player's browser stops waiting: pressed again, it's joined
	ctx := context.WithoutCancel(r.Context())
	games, err := s.nasGames.ListAll(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	// A game of this ROM that this player started and is still running is joined again rather than started twice: a
	// second press, or one after a connection that didn't come up, lands in the same game. Any other is a second game
	for _, game := range games {
		if game.Ended || game.StartedBy != scope.User.ID || game.Console == 2 {
			continue
		}
		// A linked game is joined again on the starter's console, and a game of one console only as one
		if game.LibraryOwner == scope.LibraryOwnerID && game.Rom == romID && game.Core == core &&
			linked == (game.Console == 1) {
			writeJSON(w, http.StatusOK, nasCodes(game))
			return
		}
		writeError(w, errNASOneGame)
		return
	}
	// A save of an ended game of this player's that's still waiting to be kept is kept first, so the game starts from
	// it rather than from the save before
	for _, game := range games {
		if game.Ended && nasSaveOwner(game) == scope.User.ID && nasSaveRom(game) == romID {
			if err := s.collectNASGame(ctx, game); err != nil {
				log.Printf("nas games: keeping the save of %s before starting it again: %v", game.ID, err)
				writeError(w, errNASSaveWaiting)
				return
			}
		}
	}
	// It starts with the player's latest save of the game with this emulator, made here or on the NAS
	var save []byte
	if linked {
		save, err = s.linkedStartSave(ctx, scope, romID)
	} else {
		var latest *library.GameSave
		latest, err = library.LatestGameSave(ctx, scope, core, romID)
		if err == nil {
			save, err = readNASStartSave(scope, latest)
		}
	}
	if err != nil {
		writeError(w, err)
		return
	}
	bioses, options, err := s.nasSettings(r, scope, platform, core)
	if err != nil {
		writeError(w, err)
		return
	}
	// A game on several discs is started from a list of them all, as in the browser
	var discs []nasgames.Disc
	if discGroup.Valid && discGroup.String != "" {
		found, err := library.Discs(r.Context(), scope, platform, discGroup.String)
		if err != nil {
			writeError(w, err)
			return
		}
		for _, disc := range found {
			if rest, ok := strings.CutPrefix(disc.FileID, "roms/"); ok {
				discs = append(discs, nasgames.Disc{File: rest, FileName: disc.FileName})
			}
		}
	}
	start := nasgames.Start{
		Bioses: bioses, Controls: controls, Core: core, Discs: discs, File: file, FileName: fileName,
		LibraryOwner: scope.LibraryOwnerID, Options: options, Platform: platform, Rom: romID, Save: save,
		SaveType: saveType, StartedBy: scope.User.ID,
		Title: title,
	}
	if !linked {
		game, err := s.nasGames.Start(ctx, start)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, nasCodes(game))
		return
	}
	for key, value := range linkedOptions {
		start.Options[key] = value
	}
	start.KeepAsCore, start.KeepAsFileType = linkedSaveCore, linkedSaveType
	linkedGames, err := s.nasGames.StartLinked(ctx, start)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nasCodes(linkedGames[0]))
}

// readNASStartSave is a version of a save to start a game on the NAS with: nothing for none. One too large for the
// service, or that can't be read, isn't started with: the game would start blank, and its blank save become the newest
func readNASStartSave(scope library.Scope, save *library.GameSave) ([]byte, error) {
	if save == nil {
		return nil, nil
	}
	if save.Size > nasgames.MaxSave {
		return nil, nasgames.ErrSaveTooBig
	}
	content, err := scope.Storage.Read(save.FileID)
	if err != nil {
		log.Printf("nas games: reading save %s: %v", save.ID, err)
		return nil, errNASSaveUnreadable
	}
	return content, nil
}

// dsCore is the emulator a player plays DS games with in the browser
func (s *Server) dsCore(ctx context.Context, scope library.Scope) string {
	resolved, err := s.preference.Get(ctx, s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return ""
	}
	emulator, _ := resolved["emulator"].(preference.Object)
	platforms, _ := emulator["platform"].(preference.Object)
	settings, _ := platforms["nds"].(preference.Object)
	core, _ := settings["core"].(string)
	return core
}

// linkedStartSave is the save a player's console of a linked game starts from: their melonDS save, or their save with
// a DeSmuME, the DS emulator in the browser, when that's newer, as the plain save inside it
func (s *Server) linkedStartSave(ctx context.Context, scope library.Scope, rom string) ([]byte, error) {
	latest, err := library.LatestGameSave(ctx, scope, linkedSaveCore, rom)
	if err != nil {
		return nil, err
	}
	if own := s.dsCore(ctx, scope); desmumeCores[own] {
		theirs, err := library.LatestGameSave(ctx, scope, own, rom)
		if err != nil {
			return nil, err
		}
		if theirs != nil && (latest == nil || time.Time(theirs.CreatedAt).After(time.Time(latest.CreatedAt))) {
			dsv, err := readNASStartSave(scope, theirs)
			if err != nil {
				return nil, err
			}
			if plain, ok := library.SaveFromDSV(dsv); ok {
				return plain, nil
			}
		}
	}
	return readNASStartSave(scope, latest)
}

// nasCodes is the code that joins a game, and for the starter's console of a linked pair, the code that joins the
// friend's
func nasCodes(game nasgames.Game) map[string]string {
	codes := map[string]string{"code": nasCode(game.ID)}
	if game.Console == 1 && game.LinkedWith != "" {
		codes["friendCode"] = nasCode(game.LinkedWith)
	}
	return codes
}

// How long ending a game, and keeping its last save, may take before the player is answered
const nasStopWithin = 30 * time.Second

// stopNASGame ends a game on the NAS: for whoever started it, or an admin. Its last save is kept before the answer, so
// the page the player returns to, and their other devices, start from it
func (s *Server) stopNASGame(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	id, isNAS := nasGameID(r.PathValue("code"))
	if !isNAS {
		writeError(w, errNASGameNotFound)
		return
	}
	game, err := s.nasGame(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	if game.StartedBy != scope.User.ID && scope.User.Role != auth.RoleAdmin {
		writeError(w, errNASNotYours)
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), nasStopWithin)
	defer cancel()
	if err := s.nasGames.Stop(ctx, id); err != nil {
		writeError(w, err)
		return
	}
	s.collectEndedNASGames(ctx, id, game.LinkedWith)
	writeJSON(w, http.StatusOK, nil)
}

// collectEndedNASGames keeps the last saves of the games with these ids, once they've ended
func (s *Server) collectEndedNASGames(ctx context.Context, ids ...string) {
	games, err := s.nasGames.ListAll(ctx)
	if err != nil {
		return
	}
	for _, game := range games {
		if slices.Contains(ids, game.ID) {
			if err := s.collectNASGame(ctx, game); err != nil {
				log.Printf("nas games: keeping the last save of %s (%s): %v", game.ID, game.Title, err)
			}
		}
	}
}

// stopNASGamesOf ends the games a player started on the NAS, as their account is deleted: what they make is no one's
// to keep
func (s *Server) stopNASGamesOf(ctx context.Context, user string) {
	if s.nasGames == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), nasStopWithin)
	defer cancel()
	games, err := s.nasGames.List(ctx)
	if err != nil {
		log.Printf("nas games: ending the games of deleted user %s: %v", user, err)
		return
	}
	for _, game := range games {
		// A linked pair ends together, by either console
		if game.StartedBy == user && game.Console != 2 {
			if err := s.nasGames.Stop(ctx, game.ID); err != nil {
				log.Printf("nas games: ending %s of deleted user %s: %v", game.ID, user, err)
			}
		}
	}
}

// How often the games on the NAS are asked for their own saves, and how long keeping each game's may take. A game
// keeps its save every 10 seconds when it changes, and as it ends
const nasSaveEvery = 20 * time.Second

// collectNASSaves keeps, every little while, the saves of games on the NAS that changed, with the player who started
// each, as a version of their save of the game: the same as one made playing in their browser
func (s *Server) collectNASSaves() {
	for range time.Tick(nasSaveEvery) {
		s.collectNASSavesOnce(context.Background())
	}
}

func (s *Server) collectNASSavesOnce(ctx context.Context) {
	listed, cancel := context.WithTimeout(ctx, nasSaveEvery)
	games, err := s.nasGames.ListAll(listed)
	cancel()
	// The client logs the service not answering
	if err != nil {
		return
	}
	s.forgetNASGamesExcept(games)
	for _, game := range games {
		kept, cancel := context.WithTimeout(ctx, nasSaveEvery)
		err := s.collectNASGame(kept, game)
		cancel()
		if err == nil {
			s.nas.failing.Delete(game.ID)
			continue
		}
		if last, _ := s.nas.failing.Swap(game.ID, err.Error()); last != err.Error() {
			log.Printf("nas games: keeping the save of %s (%s): %v", game.ID, game.Title, err)
		}
	}
}

// forgetNASGamesExcept lets go of what's kept of games the service no longer has
func (s *Server) forgetNASGamesExcept(games []nasgames.Game) {
	present := map[string]bool{}
	for _, game := range games {
		present[game.ID] = true
	}
	for _, kept := range []*sync.Map{&s.nas.unkept, &s.nas.failing, &s.nas.giving} {
		kept.Range(func(key, _ any) bool {
			if !present[key.(string)] {
				kept.Delete(key)
			}
			return true
		})
	}
	s.nas.joined.Range(func(key, value any) bool {
		joined, _ := value.(time.Time)
		if id, _, _ := strings.Cut(key.(string), "|"); !present[id] || time.Since(joined) > nasJoinedFor {
			s.nas.joined.Delete(key)
		}
		return true
	})
}

// nasSaveOwner is the player whose save a game's own save is kept as: whoever started it, or for a friend's console of
// a linked pair, the friend whose save it was given. None for a friend's console nobody has been given
func nasSaveOwner(game nasgames.Game) string {
	if game.Console == 2 {
		if game.KeepFor == nil {
			return ""
		}
		return game.KeepFor.User
	}
	return game.StartedBy
}

// nasSaveRom is the game in its owner's library a game's save is kept for
func nasSaveRom(game nasgames.Game) string {
	if game.Console == 2 {
		if game.KeepFor == nil {
			return ""
		}
		return game.KeepFor.Rom
	}
	return game.Rom
}

// collectNASGame keeps a game's own save, when it has one not yet kept, as a version of its owner's save of the game,
// and tells the service it was kept. A save that can't ever be kept, as its owner's account or its game is gone, is
// let go: the service is told, and it's not asked for again
func (s *Server) collectNASGame(ctx context.Context, game nasgames.Game) error {
	if game.StartedBy == "" || game.Rom == "" || game.LibraryOwner == "" {
		return nil
	}
	if _, unkept := s.nas.unkept.Load(game.ID); unkept {
		return nil
	}
	owner, libraryOwner, rom := nasSaveOwner(game), game.LibraryOwner, nasSaveRom(game)
	if owner == "" {
		return nil
	}
	if game.Console == 2 {
		libraryOwner = game.KeepFor.LibraryOwner
	}
	content, sum, err := s.nasGames.Save(ctx, game.ID)
	if errors.Is(err, nasgames.ErrSaveTooBig) {
		s.nas.unkept.Store(game.ID, true)
		return fmt.Errorf("its save is larger than %d MiB, and isn't kept", nasgames.MaxSave>>20)
	}
	if err != nil || content == nil {
		return err
	}
	inUse, err := s.userInUse(ctx, owner)
	if err != nil {
		return err
	}
	if !inUse {
		s.nas.unkept.Store(game.ID, true)
		if err := s.nasGames.Collected(ctx, game.ID, sum); err != nil {
			return err
		}
		if !game.Ended && game.StartedBy == owner {
			return s.nasGames.Stop(ctx, game.ID)
		}
		return nil
	}
	scope := library.Scope{
		Database: s.database, LibraryOwnerID: libraryOwner, MaxAutoStates: s.config.MaxAutoStatesPerRom,
		Messages: s.languages.T, Storage: files.Storage{Path: s.config.FilePath}, User: &auth.User{ID: owner},
	}
	save := library.NewGameSave{Content: bytes.NewReader(content), Core: game.Core, Rom: rom}
	if game.SaveType != "" {
		save.FileType = &game.SaveType
	}
	// Kept as another emulator's save, where its saves are the same: a linked DS game's as melonDS's
	if game.KeepAsCore != "" {
		save.Core = game.KeepAsCore
		save.FileType = nil
		if game.KeepAsFileType != "" {
			save.FileType = &game.KeepAsFileType
		}
	}
	// A save kept already, when the service wasn't told, isn't kept again over what the player has made since
	kept, err := library.KeptFromServer(ctx, scope, save.Core, rom, game.ID, sum)
	if err != nil {
		return err
	}
	if !kept {
		if _, err := library.KeepServerGameSave(ctx, scope, save, game.ID, game.Started); err != nil {
			if !library.IsRomNotFound(err) {
				return err
			}
			s.nas.unkept.Store(game.ID, true)
			if err := s.nasGames.Collected(ctx, game.ID, sum); err != nil {
				return err
			}
			return errors.New("its game is no longer in the library, so its saves aren't kept")
		}
		if save.Core == linkedSaveCore {
			s.keepAsDeSmuMESave(ctx, scope, game, rom, content)
		}
	}
	if err := s.nasGames.Collected(ctx, game.ID, sum); err != nil {
		return fmt.Errorf("telling the server it was kept: %w", err)
	}
	return nil
}

// keepAsDeSmuMESave keeps a linked game's save also as the player's DeSmuME save, when they play DS games with a
// DeSmuME in the browser and have a save of the game with it to make it like: their next game in the browser starts
// from it
func (s *Server) keepAsDeSmuMESave(ctx context.Context, scope library.Scope, game nasgames.Game, rom string, save []byte) {
	own := s.dsCore(ctx, scope)
	if !desmumeCores[own] {
		return
	}
	latest, err := library.LatestGameSave(ctx, scope, own, rom)
	if err != nil || latest == nil || latest.Size > nasgames.MaxSave {
		return
	}
	like, err := scope.Storage.Read(latest.FileID)
	if err != nil {
		return
	}
	dsv, ok := library.DSVFromSave(save, like)
	if !ok {
		return
	}
	fileType := "dsv"
	input := library.NewGameSave{Content: bytes.NewReader(dsv), Core: own, FileType: &fileType, Rom: rom}
	if _, err := library.KeepServerGameSave(ctx, scope, input, game.ID, game.Started); err != nil {
		log.Printf("nas games: keeping the save of %s as %s's: %v", game.ID, own, err)
	}
}

// userInUse is whether a player's account is still in use: a deleted one's games keep nothing
func (s *Server) userInUse(ctx context.Context, user string) (bool, error) {
	var found int
	err := s.database.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ? AND status = ? LIMIT 1`, user,
		db.StatusNormal).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// A save state's id on the NAS: the date, time and millisecond it was saved
var nasStateID = regexp.MustCompile(`^[0-9]{8}-[0-9]{9}$`)

// The NAS game a request is about, from its code. Its states are kept for whoever started it, and are theirs, an
// admin's, or those of a player who joined the game, to see, save and load, as anyone in the game may pause it
func (s *Server) nasGameFromCode(w http.ResponseWriter, r *http.Request, scope library.Scope) (string, bool) {
	id, isNAS := nasGameID(r.PathValue("code"))
	if !isNAS {
		writeError(w, errNASGameNotFound)
		return "", false
	}
	game, err := s.nasGame(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return "", false
	}
	if !s.inNASGame(game, scope.User) {
		writeError(w, errNASStatesNotYours)
		return "", false
	}
	return id, true
}

// inNASGame is whether a player is in a game on the NAS: they started it, are an admin, were given its save, or
// joined it
func (s *Server) inNASGame(game nasgames.Game, user *auth.User) bool {
	if game.StartedBy == user.ID || user.Role == auth.RoleAdmin || game.KeepFor != nil && game.KeepFor.User == user.ID {
		return true
	}
	joined, found := s.nas.joined.Load(game.ID + "|" + user.ID)
	at, _ := joined.(time.Time)
	return found && time.Since(at) < nasJoinedFor
}

func (s *Server) nasStates(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	id, ok := s.nasGameFromCode(w, r, scope)
	if !ok {
		return
	}
	states, err := s.nasGames.States(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, states)
}

func (s *Server) saveNASState(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	id, ok := s.nasGameFromCode(w, r, scope)
	if !ok {
		return
	}
	state, err := s.nasGames.SaveState(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

var errNASNoState = failure.Coded(http.StatusNotFound, "server_no_state", "No such state")

func (s *Server) loadNASState(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	state := r.PathValue("state")
	if !nasStateID.MatchString(state) {
		writeError(w, errNASNoState)
		return
	}
	id, ok := s.nasGameFromCode(w, r, scope)
	if !ok {
		return
	}
	if err := s.nasGames.LoadState(r.Context(), id, state); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, true)
}

func (s *Server) nasStatePicture(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	state := r.PathValue("state")
	if !nasStateID.MatchString(state) {
		writeError(w, errNASNoState)
		return
	}
	id, ok := s.nasGameFromCode(w, r, scope)
	if !ok {
		return
	}
	picture, err := s.nasGames.StatePicture(r.Context(), id, state)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(picture)
}

// nasSettings is what the NAS's emulator starts with, as the browser's would: the player's BIOS files for the console,
// as their settings list them, and their settings for the emulator, such as the DS's stylus following the pointer.
// Only the settings the app shows for the emulator are given, at the values it offers, and those that would have one
// game take what the others need are the NAS's own (serverCoreOptions)
func (s *Server) nasSettings(r *http.Request, scope library.Scope, platform, core string) ([]nasgames.File, map[string]string, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return nil, nil, err
	}
	emulator, _ := resolved["emulator"].(preference.Object)
	cores, _ := emulator["core"].(preference.Object)
	coreSettings, _ := cores[core].(preference.Object)
	allowed := s.nas.coreOptions[core]
	options := map[string]string{}
	for key, value := range coreSettings {
		if text, ok := value.(string); ok && slices.Contains(allowed[key], text) {
			options[key] = text
		}
	}
	for key, value := range serverCoreOptions[core] {
		options[key] = value
	}
	platforms, _ := emulator["platform"].(preference.Object)
	settings, _ := platforms[platform].(preference.Object)
	listed, _ := settings["bioses"].([]any)
	var bioses []nasgames.File
	for _, item := range listed {
		bios, _ := item.(preference.Object)
		id, _ := bios["fileId"].(string)
		name, _ := bios["fileName"].(string)
		if id == "" || name == "" {
			continue
		}
		content, err := scope.Storage.Read(id)
		if err != nil {
			continue
		}
		bioses = append(bioses, nasgames.File{Content: content, Name: name})
	}
	return bioses, options, nil
}
