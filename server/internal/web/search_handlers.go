package web

import (
	"net/http"

	"retroassembly/server/internal/library"
)

// GET /api/v1/roms/search: a page of the games matching a search, best match first
func (s *Server) searchRoms(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	var check validation
	page := check.number("page", query, 1)
	pageSize := check.number("page_size", query, 100)
	var platform *string
	if value, present := field(query, "platform"); present {
		text, _ := check.OptionalString("platform", value, present, 0, 0)
		platform = &text
	}
	searchValue, searchPresent := field(query, "query")
	text := check.String("query", searchValue, searchPresent, 1)
	if check.Failed(w) {
		return
	}
	platforms, err := s.platforms(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := library.SearchRoms(r.Context(), scope, platforms, platform, text, page, pageSize)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(result.Roms); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// GET /api/v1/roms/search_counts: how many games match a search, in all and on each console, for the sidebar
func (s *Server) searchCounts(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	value, present := field(r.URL.Query(), "query")
	text, _ := check.OptionalString("query", value, present, 1, 100)
	if !present {
		check.String("query", value, present, 1)
	}
	if check.Failed(w) {
		return
	}
	platforms, err := s.platforms(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	counts, err := library.CountSearchMatches(r.Context(), scope, platforms, text)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, counts)
}
