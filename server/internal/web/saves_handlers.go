package web

import (
	"io"
	"mime/multipart"
	"net/http"

	"retroassembly/server/internal/library"
)

func readUpload(upload *multipart.FileHeader) ([]byte, error) {
	file, err := upload.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

// GET /api/v1/states: a game's saves of one type
func (s *Server) listStates(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	var check validation
	romValue, romPresent := field(query, "rom")
	rom := check.String("rom", romValue, romPresent, 0)
	typeValue, typePresent := field(query, "type")
	stateType := check.Enum("type", typeValue, typePresent, "manual", "auto")
	if check.Failed(w) {
		return
	}
	states, err := library.GetStates(r.Context(), scope, library.StatesQuery{Rom: rom, Type: stateType})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, states)
}

// GET /api/v1/roms/{id}/states: a game's saves, manual ones unless asked for automatic ones
func (s *Server) listRomStates(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	stateType := "manual"
	var check validation
	if value, present := field(query, "type"); present {
		stateType = check.Enum("type", value, present, "auto", "manual")
	}
	if check.Failed(w) {
		return
	}
	states, err := library.GetStates(r.Context(), scope, library.StatesQuery{Rom: r.PathValue("id"), Type: stateType})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, states)
}

func (s *Server) createState(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, fileBodyLimit) {
		return
	}
	values := r.PostForm
	var check validation
	input := library.NewState{}
	if value, present := field(values, "clientId"); present {
		clientID, _ := check.OptionalString("clientId", value, present, 1, 64)
		input.ClientID = &clientID
	}
	coreValue, corePresent := field(values, "core")
	input.Core = check.String("core", coreValue, corePresent, 0)
	discValue, discPresent := field(values, "disc")
	if disc, ok := check.OptionalInt("disc", discValue, discPresent, 1); ok {
		input.Disc = &disc
	}
	romValue, romPresent := field(values, "rom")
	input.Rom = check.String("rom", romValue, romPresent, 0)
	stateUpload, thumbnailUpload := formFile(r, "state"), formFile(r, "thumbnail")
	check.File("state", stateUpload, values, "Blob")
	check.File("thumbnail", thumbnailUpload, values, "Blob")
	typeValue, typePresent := field(values, "type")
	input.Type = check.Enum("type", typeValue, typePresent, "auto", "manual")
	if check.Failed(w) {
		return
	}
	var err error
	if input.State, err = readUpload(stateUpload); err != nil {
		writeError(w, err)
		return
	}
	if input.Thumbnail, err = readUpload(thumbnailUpload); err != nil {
		writeError(w, err)
		return
	}
	state, err := library.CreateState(r.Context(), scope, input)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) deleteState(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.DeleteState(r.Context(), scope, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (s *Server) listGameSaves(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	var check validation
	coreValue, corePresent := field(query, "core")
	core := check.String("core", coreValue, corePresent, 0)
	romValue, romPresent := field(query, "rom")
	rom := check.String("rom", romValue, romPresent, 0)
	if check.Failed(w) {
		return
	}
	saves, err := library.ListGameSaves(r.Context(), scope, core, rom)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saves)
}

func (s *Server) createGameSave(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, fileBodyLimit) {
		return
	}
	values := r.PostForm
	var check validation
	input := library.NewGameSave{}
	if value, present := field(values, "clientId"); present {
		clientID, _ := check.OptionalString("clientId", value, present, 1, 64)
		input.ClientID = &clientID
	}
	coreValue, corePresent := field(values, "core")
	input.Core = check.String("core", coreValue, corePresent, 0)
	upload := formFile(r, "file")
	check.File("file", upload, values, "Blob")
	if value, present := field(values, "fileType"); present {
		fileType, _ := check.OptionalString("fileType", value, present, 0, 8)
		input.FileType = &fileType
	}
	romValue, romPresent := field(values, "rom")
	input.Rom = check.String("rom", romValue, romPresent, 0)
	if check.Failed(w) {
		return
	}
	var err error
	if input.Content, err = readUpload(upload); err != nil {
		writeError(w, err)
		return
	}
	saved, err := library.CreateGameSave(r.Context(), scope, input)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) restoreGameSave(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	restored, err := library.RestoreGameSave(r.Context(), scope, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, restored)
}
