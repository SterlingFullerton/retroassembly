package web

import (
	"math"
	"net/http"
	"path"
	"strconv"
	"strings"

	"retroassembly/server/internal/i18n"
	"retroassembly/server/internal/ids"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
)

// jsNumber reads text as JavaScript's Number() does: blank is 0, 0x, 0o and 0b prefixes are hexadecimal, octal and
// binary, and anything else that isn't a number is NaN
func jsNumber(text string) float64 {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}
	if len(trimmed) > 2 && trimmed[0] == '0' {
		bases := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}
		if base, ok := bases[trimmed[1]]; ok {
			if n, err := strconv.ParseUint(trimmed[2:], base, 64); err == nil {
				return float64(n)
			}
			return math.NaN()
		}
	}
	switch trimmed {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "inf") || strings.Contains(lower, "nan") || strings.Contains(lower, "_") || strings.Contains(lower, "p") {
		return math.NaN()
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.NaN()
	}
	return n
}

// The fields a player can edit, in the order the schema checks them
var editFields = []string{
	"gameBoxartFileIds", "gameDescription", "gameDeveloper", "gameGenres", "gameName", "gamePlayers", "gamePublisher",
	"gameReleaseDate", "gameThumbnailFileIds", "gameTitle",
}

// PATCH /api/v1/roms/{id}: the player's own name, details and release date of a game
func (s *Server) updateRom(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, textBodyLimit) {
		return
	}
	var check validation
	given := map[string]string{}
	for _, name := range editFields {
		value, present := field(r.PostForm, name)
		maximum := 0
		if name == "gameTitle" {
			maximum = 200
		}
		if text, ok := check.OptionalString(name, value, present, 0, maximum); ok {
			given[name] = text
		}
	}
	if check.Failed(w) {
		return
	}

	// Dates are typed as the player writes them: as their language does, unless their settings say otherwise
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		writeError(w, err)
		return
	}
	ui, _ := resolved["ui"].(preference.Object)
	dateFormat, _ := ui["dateFormat"].(string)
	if dateFormat == "auto" {
		dateFormat = s.languages.DateFormat(scope.Language)
	}

	fields := map[string]any{}
	for name, text := range given {
		if text == "" {
			fields[name] = nil
		} else {
			fields[name] = text
		}
	}
	// "Unknown" is stored as none
	players := math.Trunc(jsNumber(given["gamePlayers"]))
	if _, ok := given["gamePlayers"]; !ok || math.IsNaN(players) || players == 0 {
		fields["gamePlayers"] = nil
	} else {
		fields["gamePlayers"] = players
	}
	// A date that can't be read is refused, rather than stored as none. A date saved sets the year with it; an empty
	// one leaves the year that was found, for games with only a year
	fields["gameReleaseDate"] = nil
	if typed := strings.TrimSpace(given["gameReleaseDate"]); typed != "" {
		date, ok := i18n.ParseDate(typed, dateFormat)
		if !ok {
			writeMessage(w, http.StatusBadRequest, "Invalid release date")
			return
		}
		fields["gameReleaseDate"] = date
		fields["gameReleaseYear"] = date.Year()
	}

	updated, err := library.UpdateRom(r.Context(), scope, r.PathValue("id"), fields)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// storeImage keeps an image uploaded for a game, under the user who added it, and is its file id
func storeImage(r *http.Request, scope library.Scope, rom library.Rom, field string) (string, error) {
	upload := formFile(r, field)
	file, err := upload.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	fileID := path.Join(library.PicturesFolder(scope.LibraryOwnerID, rom.Platform, rom.ID), ids.New()+extension(upload.Filename))
	return fileID, scope.Storage.Put(fileID, file)
}

// imageUpload checks a form has an image file, and that the user may change the game, which it is
func (s *Server) imageUpload(w http.ResponseWriter, r *http.Request, scope library.Scope) (library.Rom, bool) {
	if !parseForm(w, r, imageBodyLimit) {
		return library.Rom{}, false
	}
	var check validation
	check.File("file", formFile(r, "file"), r.PostForm, "File")
	if check.Failed(w) {
		return library.Rom{}, false
	}
	if err := library.AssertCanWrite(scope); err != nil {
		writeError(w, err)
		return library.Rom{}, false
	}
	rom, err := library.FindRom(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return library.Rom{}, false
	}
	return rom, true
}

// POST /api/v1/roms/{id}/boxart: a game's own box art, in place of any it had. Answers the box art's file id
// removePicture deletes a picture a game no longer shows, when it's one the user added to that game. A file id set
// some other way, pointing anywhere else, is left alone: so is one that only starts in the game's folder and climbs out
// of it with "..", which would otherwise name any stored file
func removePicture(scope library.Scope, rom library.Rom, fileID string) {
	if ownPicture(scope, rom, fileID) {
		scope.Storage.Delete(fileID)
	}
}

func ownPicture(_ library.Scope, rom library.Rom, fileID string) bool {
	return library.IsPictureOf(fileID, rom.Platform, rom.ID)
}

func (s *Server) addBoxart(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	rom, ok := s.imageUpload(w, r, scope)
	if !ok {
		return
	}
	previous, _, err := library.RomFiles(r.Context(), scope, rom.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	fileID, err := storeImage(r, scope, rom, "file")
	if err != nil {
		writeError(w, err)
		return
	}
	updated, err := library.UpdateRom(r.Context(), scope, rom.ID, map[string]any{"gameBoxartFileIds": fileID})
	if err != nil {
		writeError(w, err)
		return
	}
	if previous != nil {
		removePicture(scope, rom, *previous)
	}
	writeJSON(w, http.StatusOK, updated.Get("gameBoxartFileIds"))
}

func (s *Server) removeBoxart(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.AssertCanWrite(scope); err != nil {
		writeError(w, err)
		return
	}
	rom, err := library.FindRom(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	previous, _, err := library.RomFiles(r.Context(), scope, rom.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := library.UpdateRom(r.Context(), scope, rom.ID, map[string]any{"gameBoxartFileIds": nil}); err != nil {
		writeError(w, err)
		return
	}
	if previous != nil {
		removePicture(scope, rom, *previous)
	}
	writeJSON(w, http.StatusOK, nil)
}

func splitIDs(list *string) []string {
	if list == nil || *list == "" {
		return nil
	}
	return strings.Split(*list, ",")
}

// POST /api/v1/roms/{id}/thumbnail: a screenshot added to a game's. Answers them all, comma separated
func (s *Server) addThumbnail(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	rom, ok := s.imageUpload(w, r, scope)
	if !ok {
		return
	}
	_, thumbnails, err := library.RomFiles(r.Context(), scope, rom.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	fileID, err := storeImage(r, scope, rom, "file")
	if err != nil {
		writeError(w, err)
		return
	}
	list := append(splitIDs(thumbnails), fileID)
	updated, err := library.UpdateRom(r.Context(), scope, rom.ID, map[string]any{"gameThumbnailFileIds": strings.Join(list, ",")})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated.Get("gameThumbnailFileIds"))
}

// DELETE /api/v1/roms/{id}/thumbnail/{thumbnailId...}: a screenshot taken off a game's. Answers the rest, comma
// separated, or nothing when none are left
func (s *Server) removeThumbnail(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.AssertCanWrite(scope); err != nil {
		writeError(w, err)
		return
	}
	rom, err := library.FindRom(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	_, thumbnails, err := library.RomFiles(r.Context(), scope, rom.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	removed := r.PathValue("thumbnailId")
	var kept []string
	for _, id := range splitIDs(thumbnails) {
		if id != removed {
			kept = append(kept, id)
		}
	}
	var value any
	if len(kept) > 0 {
		value = strings.Join(kept, ",")
	}
	updated, err := library.UpdateRom(r.Context(), scope, rom.ID, map[string]any{"gameThumbnailFileIds": value})
	if err != nil {
		writeError(w, err)
		return
	}
	if len(kept) < len(splitIDs(thumbnails)) {
		removePicture(scope, rom, removed)
	}
	writeJSON(w, http.StatusOK, updated.Get("gameThumbnailFileIds"))
}

func (s *Server) deleteRom(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.DeleteRom(r.Context(), scope, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

// DELETE /api/v1/roms?ids=: several games at once, comma separated
func (s *Server) deleteRoms(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	value, present := field(r.URL.Query(), "ids")
	text := check.String("ids", value, present, 1)
	if check.Failed(w) {
		return
	}
	var gameIDs []string
	for _, id := range strings.Split(text, ",") {
		if id = strings.TrimSpace(id); id != "" {
			gameIDs = append(gameIDs, id)
		}
	}
	if err := library.DeleteRoms(r.Context(), scope, gameIDs); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}
