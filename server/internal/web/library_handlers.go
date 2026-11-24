package web

import (
	"errors"
	"net/http"
	"os"
	"path"
	"strings"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/failure"
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
	if current.user == nil {
		writeMessage(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	end, err := s.signIns.begin(clientAddress(r), current.user.Username)
	if err != nil {
		writeError(w, err)
		return
	}
	err = auth.UpdatePassword(r.Context(), s.database, current.user, current.token, values["password"], values["new_password"], s.authMode)
	end(outcomeOf(err))
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

// settings is the user's settings, resolved, as their pages show them: with the server's BIOS files, which an admin
// may change and so sees without the mark that keeps everyone else from trying
func (s *Server) settings(r *http.Request, user *auth.User, libraryOwnerID string) (preference.Object, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, user.ID, libraryOwnerID)
	if err != nil {
		return nil, err
	}
	return shownTo(user, resolved), nil
}

func shownTo(user *auth.User, resolved preference.Object) preference.Object {
	if user.IsAdmin() {
		return preference.Unshared(resolved)
	}
	return resolved
}

func (s *Server) getPreference(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	resolved, err := s.settings(r, scope.User, scope.LibraryOwnerID)
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
	resolved = shownTo(scope.User, resolved)
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

// The server's BIOS files for a console, which are kept in the library owner's settings, or an error for a console
// the app doesn't have or for anyone but an admin, who alone may change them
func (s *Server) bioses(r *http.Request, scope library.Scope, platform string) ([]any, error) {
	// Only a console the app has: the name is part of the BIOS file's path
	if _, known := s.platformNames[platform]; !known {
		return nil, failure.New(http.StatusBadRequest, "Unknown platform")
	}
	if !scope.User.IsAdmin() {
		return nil, failure.Forbidden
	}
	resolved, err := s.preference.Get(r.Context(), s.database, scope.LibraryOwnerID, scope.LibraryOwnerID)
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

// extension is a file name's extension as Node's path.parse gives it: none for a name that only starts with a dot
func extension(name string) string {
	base := path.Base(name)
	if dot := strings.LastIndex(base, "."); dot > 0 {
		return base[dot:]
	}
	return ""
}

// addBIOS stores a BIOS file and adds it to the server's for its console, in place of one of the same name. Only for
// admins
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
	// Held until it's in the user's settings, so another user's removal can't delete the file found here first
	unlock := files.Lock(fileID)
	defer func() { unlock() }()
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
	var previous []string
	for _, item := range bioses {
		if bios, ok := item.(preference.Object); ok && bios["fileName"] == upload.Filename {
			if id, _ := bios["fileId"].(string); id != fileID {
				previous = append(previous, id)
			}
			bios["fileId"] = fileID
			replaced = true
			break
		}
	}
	if !replaced {
		bioses = append(bioses, preference.Object{"fileId": fileID, "fileName": upload.Filename})
	}
	err = s.preference.UpdateBioses(r.Context(), s.database, scope.LibraryOwnerID, platform, bioses, fileID)
	unlock()
	unlock = func() {}
	if err != nil {
		writeError(w, err)
		return
	}
	s.removeUnusedBioses(r, previous)
	resolved, err := s.settings(r, scope.User, scope.LibraryOwnerID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resolved)
}

// removeUnusedBioses deletes the BIOS files that are in no one's settings any more. One file is shared by everyone
// who added the same content
func (s *Server) removeUnusedBioses(r *http.Request, fileIDs []string) {
	for _, fileID := range fileIDs {
		unlock := files.Lock(fileID)
		var users int
		err := s.database.QueryRowContext(r.Context(),
			`SELECT count(*) FROM user_preferences WHERE instr(emulator, ?) > 0`, fileID).Scan(&users)
		if err == nil && users == 0 {
			if filePath, ok := s.config.FilePath(fileID); ok && strings.HasPrefix(fileID, "bioses/") {
				os.Remove(filePath)
			}
		}
		unlock()
	}
}

// deleteBIOS takes a BIOS file out of the server's for its console, and deletes the file. Only for admins
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
	var removed []string
	for _, item := range bioses {
		bios, ok := item.(preference.Object)
		if !ok || bios["fileName"] != fileName {
			kept = append(kept, item)
		} else if id, ok := bios["fileId"].(string); ok {
			removed = append(removed, id)
		}
	}
	if err := s.preference.UpdateBioses(r.Context(), s.database, scope.LibraryOwnerID, platform, kept, ""); err != nil {
		writeError(w, err)
		return
	}
	s.removeUnusedBioses(r, removed)
	resolved, err := s.settings(r, scope.User, scope.LibraryOwnerID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resolved)
}
