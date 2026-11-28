package web

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/library"
)

// GET /api/v1/users: every account, for the admin's settings
func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	accounts, err := auth.Accounts(r.Context(), s.database, scope.User)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

// POST /api/v1/users: an account the admin adds for someone
func (s *Server) addAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, textBodyLimit) {
		return
	}
	var (
		check       validation
		libraryMode *float64
		role        string
	)
	if _, present := field(r.PostForm, "libraryMode"); present {
		mode := check.number("libraryMode", r.PostForm, 0)
		libraryMode = &mode
	}
	if value, present := field(r.PostForm, "role"); present {
		role = check.String("role", value, present, 1)
	}
	passwordValue, passwordPresent := field(r.PostForm, "password")
	password, _ := check.OptionalString("password", passwordValue, passwordPresent, 0, 0)
	usernameValue, usernamePresent := field(r.PostForm, "username")
	username := check.String("username", usernameValue, usernamePresent, 0)
	if check.Failed(w) {
		return
	}
	user, err := auth.AddAccount(r.Context(), s.database, scope.User, username, password, role, libraryMode, s.authMode, client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// PATCH /api/v1/users/{id}: an account's library (its own or the owner's), role or name, whichever are given
func (s *Server) updateAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, textBodyLimit) {
		return
	}
	var (
		check   validation
		changes auth.AccountChanges
	)
	if _, present := field(r.PostForm, "libraryMode"); present {
		libraryMode := check.number("libraryMode", r.PostForm, 0)
		changes.LibraryMode = &libraryMode
	}
	if value, present := field(r.PostForm, "role"); present {
		role := check.String("role", value, present, 0)
		changes.Role = &role
	}
	if value, present := field(r.PostForm, "username"); present {
		username := check.String("username", value, present, 0)
		changes.Username = &username
	}
	if check.Failed(w) {
		return
	}
	if changes.LibraryMode == nil && changes.Role == nil && changes.Username == nil {
		writeMessage(w, http.StatusBadRequest, "Nothing to change")
		return
	}
	user, err := auth.UpdateAccount(r.Context(), s.database, scope.User, r.PathValue("id"), changes)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// removeAccountData removes what a deleted account kept: its games on the NAS, its saves, favorites, history, own games
// and settings, and the BIOS files no one else has
func (s *Server) removeAccountData(r *http.Request, scope library.Scope, userID string) error {
	s.stopNASGamesOf(r.Context(), userID)
	if err := library.RemoveAccountData(r.Context(), s.database, scope.Storage, userID); err != nil {
		return err
	}
	var emulator sql.NullString
	err := s.database.QueryRowContext(r.Context(),
		`DELETE FROM user_preferences WHERE user_id = ? RETURNING emulator`, userID).Scan(&emulator)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	s.removeUnusedBioses(r, biosFileID.FindAllString(emulator.String, -1))
	return nil
}

// A BIOS file's id wherever it's written in an account's settings
var biosFileID = regexp.MustCompile(`bioses/[^"\\]+`)

// DELETE /api/v1/users/{id}: an account an admin deletes, with everything it kept
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	id := r.PathValue("id")
	if err := auth.DeleteAccount(r.Context(), s.database, scope.User, id); err != nil {
		writeError(w, err)
		return
	}
	if err := s.removeAccountData(r, scope, id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// POST /api/v1/users/current/delete: the signed-in user's own account, with everything it kept, once their password is
// checked
func (s *Server) deleteOwnAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, textBodyLimit) {
		return
	}
	password, _ := field(r.PostForm, "password")
	passwordText, _ := password.(string)
	end, err := s.signIns.begin(clientAddress(r), scope.User.Username)
	if err != nil {
		writeError(w, err)
		return
	}
	err = auth.DeleteOwnAccount(r.Context(), s.database, scope.User, passwordText, s.authMode)
	end(outcomeOf(err))
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.removeAccountData(r, scope, scope.User.ID); err != nil {
		writeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{MaxAge: -1, Name: "token", Path: "/"})
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GET /api/v1/sessions: where the user is signed in
func (s *Server) listSessions(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	sessions, err := auth.Sessions(r.Context(), s.database, scope.User, stateOf(r).token)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// DELETE /api/v1/sessions/others: signed out everywhere but here
func (s *Server) endOtherSessions(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	ended, err := auth.EndOtherSessions(r.Context(), s.database, scope.User, stateOf(r).token)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"ended": ended})
}

// PUT /api/v1/users/{id}/password: a new password the admin gives an account whose owner forgot theirs
func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	values, ok := form(w, r, "new_password")
	if !ok {
		return
	}
	if err := auth.ResetPassword(r.Context(), s.database, scope.User, r.PathValue("id"), values["new_password"], s.authMode); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
