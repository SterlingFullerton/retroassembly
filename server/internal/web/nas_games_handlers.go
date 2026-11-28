package web

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
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
// code a person's game is given, so the two can't be confused

const nasCodePrefix = "0"

// How long the list of games being shared waits for the NAS before going without its games
const nasListWait = 3 * time.Second

var (
	errNASGameNotFound = failure.New(http.StatusNotFound, "No game to join by that code")
	errNASNotYours     = failure.New(http.StatusForbidden, "Only whoever started a game on the NAS can stop it")
	errNASNoPlace      = failure.New(http.StatusGone, "Ask to join again")
)

func nasCode(id string) string { return nasCodePrefix + strings.ToUpper(id) }

// nasGameID is the id of the NAS game a code joins, and whether the code is one
func nasGameID(code string) (string, bool) {
	rest, found := strings.CutPrefix(strings.ToUpper(strings.TrimSpace(code)), nasCodePrefix)
	return strings.ToLower(rest), found && rest != ""
}

// A player's place in a NAS game waits for their answer, under the code and who they are
func nasPlaceKey(code string, scope library.Scope) string {
	return strings.ToUpper(code) + "|" + scope.User.ID
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
		// A linked pair is listed by its friend's console: the starter's is theirs, and joined from the game's page
		if game.Console == 1 {
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

// findNASInvitation keeps a place in the game for the player asking, and gives them its offer, as a person's
// invitation would
func (s *Server) findNASInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope, code, id string) {
	game, err := s.nasGame(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	player, offer, err := s.nasGames.Offer(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	s.nasPlaces.Store(nasPlaceKey(code, scope), player)
	invitation := together.Invitation{
		Controls: game.Controls, Core: game.Core, Host: s.nasStarter(r.Context(), game), Linked: game.LinkedWith != "",
		Offer: offer, Platform: game.Platform, Title: game.Title,
	}
	if game.Console == 1 && game.LinkedWith != "" {
		invitation.FriendCode = nasCode(game.LinkedWith)
	}
	writeJSON(w, http.StatusOK, invitation)
}

func (s *Server) answerNASInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope, code, id, answer string) {
	place, found := s.nasPlaces.LoadAndDelete(nasPlaceKey(code, scope))
	player, ok := place.(int)
	if !found || !ok {
		writeError(w, errNASNoPlace)
		return
	}
	if err := s.nasGames.Answer(r.Context(), id, player, answer); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, true)
}

// nasCores is the emulators the NAS has, which decide where Play on the NAS is offered: none when it isn't set up or
// doesn't answer. Asked for at most once a minute, as it changes only when the NAS's image does
func (s *Server) nasCores(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	if s.nasGames == nil {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	s.nasCoresCache.Lock()
	defer s.nasCoresCache.Unlock()
	if time.Since(s.nasCoresCache.at) > time.Minute {
		ctx, cancel := context.WithTimeout(r.Context(), nasListWait)
		defer cancel()
		cores, err := s.nasGames.Cores(ctx)
		if err != nil {
			cores = []string{}
		}
		s.nasCoresCache.cores, s.nasCoresCache.at = cores, time.Now()
	}
	writeJSON(w, http.StatusOK, s.nasCoresCache.cores)
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

// The emulator, and kind of file, whose saves a linked game starts from and keeps its starter's save as: melonDS's
// plain .sav, the same as melonDS DS's own
const (
	linkedSaveCore = "melonds"
	linkedSaveType = "sav"
)

// errNotLinkable is a linked game asked for of a console that has no wireless to link
var errNotLinkable = failure.New(http.StatusBadRequest, "Only DS games can be played with a friend on the server")

// startNASGame runs a game from the library on the NAS, with the emulator the player has chosen for its console and
// the on-screen controls their browser shows for it. It answers with the code that joins it. With "linked", a DS game
// runs as two linked consoles, and the answer has the friend's code too
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
	// A game of this ROM that this player started and is still running is joined again rather than started twice: a
	// second press, or one after a connection that didn't come up, lands in the same game
	if games, err := s.nasGames.List(r.Context()); err == nil {
		for _, game := range games {
			// A linked game is joined again on the starter's console, and a game of one console only as one
			if !game.Ended && game.StartedBy == scope.User.ID && game.LibraryOwner == scope.LibraryOwnerID &&
				game.Rom == romID && game.Core == core && (linked == (game.Console == 1)) && game.Console != 2 {
				writeJSON(w, http.StatusOK, nasCodes(game))
				return
			}
		}
	}
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
		writeError(w, failure.New(http.StatusBadRequest, "That game's file isn't in the games folder"))
		return
	}
	// It starts with the player's latest save of the game with this emulator, made here or on the NAS
	var save []byte
	saveCore := core
	if linked {
		saveCore = linkedSaveCore
	}
	if latest, err := library.LatestGameSave(r.Context(), scope, saveCore, romID); err == nil && latest != nil {
		save, _ = scope.Storage.Read(latest.FileID)
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
		game, err := s.nasGames.Start(r.Context(), start)
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
	games, err := s.nasGames.StartLinked(r.Context(), start)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nasCodes(games[0]))
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

// stopNASGame ends a game on the NAS: for whoever started it, or an admin
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
	if err := s.nasGames.Stop(r.Context(), id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

// How often the games on the NAS are asked for their own saves. A game keeps its save every 10 seconds when it
// changes, and as it ends
const nasSaveEvery = 20 * time.Second

// collectNASSaves keeps, every little while, the saves of games on the NAS that changed, with the player who started
// each, as a version of their save of the game: the same as one made playing in their browser
func (s *Server) collectNASSaves() {
	for range time.Tick(nasSaveEvery) {
		ctx, cancel := context.WithTimeout(context.Background(), nasSaveEvery)
		s.collectNASSavesOnce(ctx)
		cancel()
	}
}

func (s *Server) collectNASSavesOnce(ctx context.Context) {
	games, err := s.nasGames.ListAll(ctx)
	if err != nil {
		return
	}
	for _, game := range games {
		// A friend's console of a linked pair starts from no save, and its save isn't the starter's to keep
		if game.StartedBy == "" || game.Rom == "" || game.LibraryOwner == "" || game.Console == 2 {
			continue
		}
		content, sha1, err := s.nasGames.Save(ctx, game.ID)
		if err != nil || content == nil {
			continue
		}
		scope := library.Scope{
			Database: s.database, LibraryOwnerID: game.LibraryOwner, MaxAutoStates: s.config.MaxAutoStatesPerRom,
			Messages: s.languages.T, Storage: files.Storage{Path: s.config.FilePath}, User: &auth.User{ID: game.StartedBy},
		}
		save := library.NewGameSave{Content: bytes.NewReader(content), Core: game.Core, Rom: game.Rom}
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
		if _, err := library.CreateGameSave(ctx, scope, save); err != nil {
			log.Printf("nas games: keeping the save of %s (%s): %v", game.ID, game.Title, err)
			continue
		}
		_ = s.nasGames.Collected(ctx, game.ID, sha1)
	}
}

// A save state's id on the NAS: the date, time and millisecond it was saved
var nasStateID = regexp.MustCompile(`^[0-9]{8}-[0-9]{9}$`)

// The NAS game a request is about, from its code: any signed-in player may save and load its states, as anyone in
// the game may pause it. The states are kept for whoever started it
func (s *Server) nasGameFromCode(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, isNAS := nasGameID(r.PathValue("code"))
	if !isNAS {
		writeError(w, errNASGameNotFound)
		return "", false
	}
	return id, true
}

func (s *Server) nasStates(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	id, ok := s.nasGameFromCode(w, r)
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

func (s *Server) saveNASState(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	id, ok := s.nasGameFromCode(w, r)
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

func (s *Server) loadNASState(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	id, ok := s.nasGameFromCode(w, r)
	state := r.PathValue("state")
	if !ok {
		return
	}
	if !nasStateID.MatchString(state) {
		writeError(w, failure.New(http.StatusNotFound, "No such state"))
		return
	}
	if err := s.nasGames.LoadState(r.Context(), id, state); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, true)
}

func (s *Server) nasStatePicture(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	id, ok := s.nasGameFromCode(w, r)
	state := r.PathValue("state")
	if !ok {
		return
	}
	if !nasStateID.MatchString(state) {
		writeError(w, failure.New(http.StatusNotFound, "No such state"))
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
// as their settings list them, and their settings for the emulator, such as the DS's stylus following the pointer
func (s *Server) nasSettings(r *http.Request, scope library.Scope, platform, core string) ([]nasgames.File, map[string]string, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return nil, nil, err
	}
	emulator, _ := resolved["emulator"].(preference.Object)
	cores, _ := emulator["core"].(preference.Object)
	coreSettings, _ := cores[core].(preference.Object)
	options := map[string]string{}
	for key, value := range coreSettings {
		if text, ok := value.(string); ok {
			options[key] = text
		}
	}
	platforms, _ := emulator["platform"].(preference.Object)
	settings, _ := platforms[platform].(preference.Object)
	listed, _ := settings["bioses"].([]any)
	var files []nasgames.File
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
		files = append(files, nasgames.File{Content: content, Name: name})
	}
	return files, options, nil
}
