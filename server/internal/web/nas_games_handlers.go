package web

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
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
		listings = append(listings, together.Listing{
			Code: nasCode(game.ID), Controls: game.Controls, Host: "NAS", Title: game.Title,
		})
	}
	return listings
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
	writeJSON(w, http.StatusOK, together.Invitation{Controls: game.Controls, Host: "NAS", Offer: offer, Title: game.Title})
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

// startNASGame runs a game from the library on the NAS, with the emulator the player has chosen for its console and
// the on-screen controls their browser shows for it. It answers with the code that joins it
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
	romID := check.String("rom", romValue, romPresent, 1)
	core := check.String("core", coreValue, corePresent, 1)
	controls := check.String("controls", controlsValue, controlsPresent, 0)
	if check.Failed(w) {
		return
	}
	var fileID, platform, title string
	err := scope.Database.QueryRowContext(r.Context(),
		`SELECT file_id, platform, COALESCE(NULLIF(game_title, ''), NULLIF(game_name, ''), file_name)
		FROM roms WHERE user_id = ? AND status = ? AND id = ? LIMIT 1`,
		scope.LibraryOwnerID, db.StatusNormal, romID,
	).Scan(&fileID, &platform, &title)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, failure.New(http.StatusNotFound, "ROM not found"))
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	// The service has the same games folder: a game's file is found there by its path inside it
	file, isGame := strings.CutPrefix(fileID, "roms/")
	if !isGame {
		writeError(w, failure.New(http.StatusBadRequest, "That game's file isn't in the games folder"))
		return
	}
	game, err := s.nasGames.Start(r.Context(), nasgames.Start{
		Controls: controls, Core: core, File: file, Platform: platform, StartedBy: scope.User.ID, Title: title,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": nasCode(game.ID)})
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
