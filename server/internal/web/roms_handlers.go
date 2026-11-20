package web

import (
	"math"
	"net/http"
	"regexp"
	"strings"

	"retroassembly/server/internal/files"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
)

// platforms is the consoles the user shows, from their settings
func (s *Server) platforms(r *http.Request, scope library.Scope) ([]string, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return nil, err
	}
	ui, _ := resolved["ui"].(preference.Object)
	values, _ := ui["platforms"].([]any)
	platforms := make([]string, 0, len(values))
	for _, value := range values {
		if name, ok := value.(string); ok {
			platforms = append(platforms, name)
		}
	}
	return platforms, nil
}

func (s *Server) picks(pick func(*http.Request, library.Scope, []string) ([]library.Object, error)) func(http.ResponseWriter, *http.Request, library.Scope) {
	return func(w http.ResponseWriter, r *http.Request, scope library.Scope) {
		platforms, err := s.platforms(r, scope)
		if err != nil {
			writeError(w, err)
			return
		}
		roms, err := pick(r, scope, platforms)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, roms)
	}
}

// Home's rows of picks: well-rated games never played, and games for two or more players
func (s *Server) rediscoverPicks(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	s.picks(func(r *http.Request, scope library.Scope, platforms []string) ([]library.Object, error) {
		return library.RediscoverPicks(r.Context(), scope, platforms)
	})(w, r, scope)
}

func (s *Server) playTogetherPicks(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	s.picks(func(r *http.Request, scope library.Scope, platforms []string) ([]library.Object, error) {
		return library.PlayTogetherPicks(r.Context(), scope, platforms)
	})(w, r, scope)
}

var monthDayPattern = regexp.MustCompile(`^\d{2}-\d{2}$`)

type regexIssue struct {
	Origin  string   `json:"origin"`
	Code    string   `json:"code"`
	Format  string   `json:"format"`
	Pattern string   `json:"pattern"`
	Path    []string `json:"path"`
	Message string   `json:"message"`
}

// Games released on a day of the year: the browser's, as MM-DD
func (s *Server) onThisDayPicks(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	value, present := field(r.URL.Query(), "date")
	date := check.String("date", value, present, 0)
	if present && !monthDayPattern.MatchString(date) {
		check.issues = append(check.issues, regexIssue{
			Origin: "string", Code: "invalid_format", Format: "regex", Pattern: `/^\d{2}-\d{2}$/u`, Path: []string{"date"},
			Message: `Invalid string: must match pattern /^\d{2}-\d{2}$/u`,
		})
	}
	if check.Failed(w) {
		return
	}
	s.picks(func(r *http.Request, scope library.Scope, platforms []string) ([]library.Object, error) {
		return library.OnThisDayPicks(r.Context(), scope, platforms, date)
	})(w, r, scope)
}

// number reads a query value as z.coerce.number().default(fallback) does, adding an issue for one that isn't a number
func (v *validation) number(name string, values map[string][]string, fallback float64) float64 {
	value, present := field(values, name)
	if !present {
		return fallback
	}
	text, _ := value.(string)
	number := jsNumber(text)
	if math.IsNaN(number) {
		v.issues = append(v.issues, nanIssue{
			Expected: "number", Code: "invalid_type", Received: "NaN", Path: []string{name},
			Message: "Invalid input: expected number, received NaN",
		})
	}
	return number
}

// GET /api/v1/launch_records: the games the player has started, most recently played first
func (s *Server) launchHistory(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	var check validation
	page := check.number("page", query, 1)
	// Checked, but not used: the Node server passes it on under a name its list doesn't read, so pages are always 100
	check.number("page_size", query, 100)
	const pageSize = 100
	if check.Failed(w) {
		return
	}
	platforms, err := s.platforms(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	history, err := library.LaunchHistory(r.Context(), scope, platforms, page, pageSize, "")
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, history)
}

// GET /api/v1/roms/by_files: which games are in the given files (comma separated), to name games kept on a device
func (s *Server) romsByFiles(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	value, present := field(r.URL.Query(), "ids")
	ids, _ := check.OptionalString("ids", value, present, 1, 4000)
	if !present {
		check.String("ids", value, present, 1)
	}
	if check.Failed(w) {
		return
	}
	var fileIDs []string
	for _, id := range strings.Split(ids, ",") {
		if id = strings.TrimSpace(id); id != "" {
			fileIDs = append(fileIDs, id)
		}
	}
	if len(fileIDs) > 100 {
		fileIDs = fileIDs[:100]
	}
	games, err := library.RomsByFiles(r.Context(), scope, fileIDs)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, games)
}

// GET /api/v1/roms/{id}/content: a game's file, whole, as the Node server sends it: without a type, a range or a check
// for a copy the browser already has
func (s *Server) romContent(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	rom, err := library.FindRom(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	var fileID string
	if err := s.database.QueryRowContext(r.Context(), `SELECT file_id FROM roms WHERE id = ?`, rom.ID).Scan(&fileID); err != nil {
		writeError(w, err)
		return
	}
	filePath, ok := s.config.FilePath(fileID)
	if !ok {
		notFound(w)
		return
	}
	whole := r.Clone(r.Context())
	whole.Header.Del("Range")
	whole.Header.Del("If-None-Match")
	files.Serve(w, whole, "", filePath)
}
