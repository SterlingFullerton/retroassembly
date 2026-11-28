package web

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
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

// accountRemoval removes what a deleted account kept: its rows, in the transaction that deletes the account (remove),
// and afterwards its files and the BIOS files no one has any more (finish)
type accountRemoval struct {
	fileIDs, bioses []string
}

func (a *accountRemoval) remove(ctx context.Context, userID string) auth.RemoveData {
	return func(transaction *sql.Tx) error {
		fileIDs, err := library.RemoveAccountRows(ctx, transaction, userID)
		if err != nil {
			return err
		}
		var emulator sql.NullString
		err = transaction.QueryRowContext(ctx,
			`DELETE FROM user_preferences WHERE user_id = ? RETURNING emulator`, userID).Scan(&emulator)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		a.fileIDs, a.bioses = fileIDs, preference.BiosFileIDs(emulator.String)
		return nil
	}
}

// finish ends the account's games on the server and removes its files once the account is deleted. It goes on if the request that deleted the account ends
// first: the account is gone, and nothing would remove them later
func (a *accountRemoval) finish(s *Server, ctx context.Context, userID string) {
	ctx = context.WithoutCancel(ctx)
	// Its games on the server end, and their saves are no one's to keep
	s.stopNASGamesOf(ctx, userID)
	library.RemoveAccountFiles(files.Storage{Path: s.config.FilePath}, userID, a.fileIDs)
	s.removeUnusedBioses(ctx, a.bioses)
}

// FinishAccountDeletions finishes deleting the accounts that were deleted before deletion forgot who they were, or
// whose deletion stopped part way. Run when the server starts
func (s *Server) FinishAccountDeletions(ctx context.Context) error {
	ids, err := auth.DeletedAccountsToFinish(ctx, s.database)
	if err != nil {
		return err
	}
	for _, id := range ids {
		var removal accountRemoval
		if err := auth.FinishDeletedAccount(ctx, s.database, id, removal.remove(ctx, id)); err != nil {
			return err
		}
		removal.finish(s, ctx, id)
	}
	if len(ids) > 0 {
		log.Printf("Finished deleting %d accounts", len(ids))
	}
	return nil
}

// DELETE /api/v1/users/{id}: an account an admin deletes, with everything it kept
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	id := r.PathValue("id")
	var removal accountRemoval
	if err := auth.DeleteAccount(r.Context(), s.database, scope.User, id, removal.remove(r.Context(), id)); err != nil {
		writeError(w, err)
		return
	}
	removal.finish(s, r.Context(), id)
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
	var removal accountRemoval
	err = auth.DeleteOwnAccount(r.Context(), s.database, scope.User, passwordText, s.authMode,
		removal.remove(r.Context(), scope.User.ID))
	end(outcomeOf(err))
	if err != nil {
		writeError(w, err)
		return
	}
	removal.finish(s, r.Context(), scope.User.ID)
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
