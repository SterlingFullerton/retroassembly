package web

import (
	"net/http"

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
	var check validation
	libraryMode := check.number("libraryMode", r.PostForm, 0)
	passwordValue, passwordPresent := field(r.PostForm, "password")
	password, _ := check.OptionalString("password", passwordValue, passwordPresent, 0, 0)
	usernameValue, usernamePresent := field(r.PostForm, "username")
	username := check.String("username", usernameValue, usernamePresent, 0)
	if check.Failed(w) {
		return
	}
	user, err := auth.AddAccount(r.Context(), s.database, scope.User, username, password, libraryMode, s.authMode, client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// PATCH /api/v1/users/{id}: whether an account has its own library or shares the admin's
func (s *Server) setLibraryMode(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if !parseForm(w, r, textBodyLimit) {
		return
	}
	var check validation
	// Required: z.coerce.number() reads nothing as NaN
	values := r.PostForm
	if _, present := field(values, "libraryMode"); !present {
		values = map[string][]string{"libraryMode": {"NaN"}}
	}
	libraryMode := check.number("libraryMode", values, 0)
	if check.Failed(w) {
		return
	}
	user, err := auth.SetLibraryMode(r.Context(), s.database, scope.User, r.PathValue("id"), libraryMode)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// DELETE /api/v1/users/{id}: an account the admin deletes
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if err := auth.DeleteAccount(r.Context(), s.database, scope.User, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
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
