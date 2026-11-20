package web

import (
	"errors"
	"net/http"
	"path"
	"strings"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
)

// signedIn answers 401 to anyone not signed in, and gives the handler the signed-in user's scope
func (s *Server) signedIn(handler func(http.ResponseWriter, *http.Request, library.Scope)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		current := stateOf(r)
		if current.user == nil {
			writeMessage(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		handler(w, r, library.Scope{
			Database:       s.database,
			Language:       current.language,
			LibraryOwnerID: current.libraryOwnerID,
			Messages:       s.languages.T,
			MaxAutoStates:  s.config.MaxAutoStatesPerRom,
			Storage:        files.Storage{Path: s.config.FilePath},
			User:           current.user,
		})
	}
}

func (s *Server) updatePassword(w http.ResponseWriter, r *http.Request) {
	values, ok := form(w, r, "new_password", "password")
	if !ok {
		return
	}
	current := stateOf(r)
	err := auth.UpdatePassword(r.Context(), s.database, current.user, current.token, values["password"], values["new_password"], s.authMode)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, true)
}

func (s *Server) addFavorite(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	body, ok := readJSON(w, r)
	if !ok {
		return
	}
	object, _ := body.(preference.Object)
	value, present := object["romId"]
	var check validation
	romID := check.String("romId", value, present, 1)
	if check.Failed(w) {
		return
	}
	favorite, err := library.AddFavorite(r.Context(), scope, romID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, favorite)
}

func (s *Server) removeFavorite(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.RemoveFavorite(r.Context(), scope, r.PathValue("romId")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (s *Server) addLaunchRecord(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	values, ok := form(w, r, "core", "rom")
	if !ok {
		return
	}
	if err := library.AddLaunchRecord(r.Context(), scope, values["rom"], values["core"]); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (s *Server) removeLaunchRecords(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := library.RemoveLaunchRecords(r.Context(), scope, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nil)
}

func (s *Server) getPreference(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resolved)
}

func (s *Server) savePreference(w http.ResponseWriter, r *http.Request, scope library.Scope, snippet preference.Object) {
	resolved, err := s.preference.Update(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID, snippet)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resolved)
}

func (s *Server) updatePreference(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	body, ok := readJSON(w, r)
	if !ok {
		return
	}
	snippet, isObject := body.(preference.Object)
	if body == nil {
		writeError(w, errors.New("Cannot read properties of null (reading 'emulator')"))
		return
	}
	if !isObject {
		snippet = preference.Object{}
	}
	s.savePreference(w, r, scope, snippet)
}

// The BIOS files in the user's settings for a console, or false for a console the app doesn't have
func (s *Server) bioses(r *http.Request, scope library.Scope, platform string) ([]any, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return nil, err
	}
	emulator, _ := resolved["emulator"].(preference.Object)
	platforms, _ := emulator["platform"].(preference.Object)
	settings, ok := platforms[platform].(preference.Object)
	if !ok {
		return nil, errors.New("Cannot destructure property 'bioses' of 'preference.emulator.platform[platform]' as it is undefined.")
	}
	bioses, _ := settings["bioses"].([]any)
	return bioses, nil
}

func biosesSnippet(platform string, bioses []any) preference.Object {
	return preference.Object{"emulator": preference.Object{"platform": preference.Object{
		platform: preference.Object{"bioses": bioses},
	}}}
}

// extension is a file name's extension as Node's path.parse gives it: none for a name that only starts with a dot
func extension(name string) string {
	base := path.Base(name)
	if dot := strings.LastIndex(base, "."); dot > 0 {
		return base[dot:]
	}
	return ""
}

// addBIOS stores a BIOS file, once however many users add it, and adds it to the user's settings for its console,
// in place of one of the same name
func (s *Server) addBIOS(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, fileBodyLimit) {
		return
	}
	var check validation
	upload := formFile(r, "file")
	check.File("file", upload, r.PostForm, "File")
	value, present := field(r.PostForm, "platform")
	platform := check.String("platform", value, present, 0)
	if check.Failed(w) {
		return
	}
	// The console is checked before the file is stored: it's part of the file's path
	bioses, err := s.bioses(r, scope, platform)
	if err != nil {
		writeError(w, err)
		return
	}
	file, err := upload.Open()
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Close()
	digest, err := files.Digest(file)
	if err != nil {
		writeError(w, err)
		return
	}
	fileID := path.Join("bioses", platform, digest+extension(upload.Filename))
	filePath, ok := s.config.FilePath(fileID)
	if !ok {
		writeError(w, errors.New("Invalid file id"))
		return
	}
	if !files.Exists(filePath) {
		if _, err := file.Seek(0, 0); err != nil {
			writeError(w, err)
			return
		}
		if err := files.Put(filePath, file); err != nil {
			writeError(w, err)
			return
		}
	}

	replaced := false
	for _, item := range bioses {
		if bios, ok := item.(preference.Object); ok && bios["fileName"] == upload.Filename {
			bios["fileId"] = fileID
			replaced = true
			break
		}
	}
	if !replaced {
		bioses = append(bioses, preference.Object{"fileId": fileID, "fileName": upload.Filename})
	}
	s.savePreference(w, r, scope, biosesSnippet(platform, bioses))
}

// deleteBIOS takes a BIOS file out of the user's settings for its console. The file stays, as others may use it
func (s *Server) deleteBIOS(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	query := r.URL.Query()
	var check validation
	fileNameValue, fileNamePresent := field(query, "file_name")
	fileName := check.String("file_name", fileNameValue, fileNamePresent, 0)
	platformValue, platformPresent := field(query, "platform")
	platform := check.String("platform", platformValue, platformPresent, 0)
	if check.Failed(w) {
		return
	}
	bioses, err := s.bioses(r, scope, platform)
	if err != nil {
		writeError(w, err)
		return
	}
	kept := []any{}
	for _, item := range bioses {
		if bios, ok := item.(preference.Object); !ok || bios["fileName"] != fileName {
			kept = append(kept, item)
		}
	}
	s.savePreference(w, r, scope, biosesSnippet(platform, kept))
}
