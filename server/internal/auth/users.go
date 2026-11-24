package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
)

// What an account may do in the server's one library: a player plays, and keeps their own saves, favorites and
// history; a contributor also adds games and edits them; an admin also deletes games and manages the accounts
const (
	RoleAdmin       = "admin"
	RoleContributor = "contributor"
	RolePlayer      = "player"
)

// Role is a stored role as one of the three: anything else, such as "user" from before there were three, is a player
func Role(stored string) string {
	if stored == RoleAdmin || stored == RoleContributor {
		return stored
	}
	return RolePlayer
}

// CanAddGames tells whether the user may add games to the library and edit them
func (u *User) CanAddGames() bool {
	return u != nil && (u.Role == RoleAdmin || u.Role == RoleContributor)
}

// IsAdmin tells whether the user manages the accounts and may delete games
func (u *User) IsAdmin() bool {
	return u != nil && u.Role == RoleAdmin
}

// withRole sets a user's role, and the library mode older pages read from it: 1, read only, for a player
func (u *User) withRole(stored string) {
	u.Role = Role(stored)
	u.LibraryMode = 0
	if u.Role == RolePlayer {
		u.LibraryMode = 1
	}
}

// roleFor is the role an account is given: the one named, or, for a page that still sends a library mode, a
// contributor for 0 (its own library, as it was) and a player for 1 (the shared one, read only)
func roleFor(role string, libraryMode *float64) (string, error) {
	switch {
	case role == RoleAdmin || role == RoleContributor || role == RolePlayer:
		return role, nil
	case role == "user":
		return RolePlayer, nil
	case role != "":
		return "", failure.New(http.StatusBadRequest, "Role must be player, contributor or admin")
	case libraryMode == nil:
		return RolePlayer, nil
	case !validLibraryMode(*libraryMode):
		return "", errInvalidLibraryMode
	case *libraryMode == 0:
		return RoleContributor, nil
	}
	return RolePlayer, nil
}

// AdminID is the library's owner: the oldest admin still in use, whose library the accounts that share one see, and
// who can't be deleted or made an ordinary user. Empty when there are no accounts
func AdminID(ctx context.Context, database *sql.DB) (string, error) {
	var id string
	err := database.QueryRowContext(ctx,
		`SELECT id FROM users WHERE status = ? AND role = ? ORDER BY created_at ASC LIMIT 1`, db.StatusNormal, RoleAdmin).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// assertIsAdmin refuses anyone but an admin, and is the owner's id
func assertIsAdmin(ctx context.Context, database *sql.DB, user *User) (string, error) {
	if !user.IsAdmin() {
		return "", failure.Forbidden
	}
	return AdminID(ctx, database)
}

var (
	errInvalidUsername    = failure.New(http.StatusBadRequest, "Username must be 2 to 32 letters, digits, dots, dashes or underscores")
	errInvalidLibraryMode = failure.New(http.StatusBadRequest, "Library mode must be 0 (own library) or 1 (shared library)")
)

// ValidUsername tells whether a new account may have a name: 2 to 32 letters, digits, dots, dashes and underscores,
// so there's no empty or look-alike name with spaces in it. Accounts made before the rule keep their names
func ValidUsername(username string) bool {
	if length := utf8.RuneCountInString(username); length < 2 || length > 32 {
		return false
	}
	for _, character := range username {
		if !unicode.IsLetter(character) && !unicode.IsDigit(character) && !strings.ContainsRune("._-", character) {
			return false
		}
	}
	return true
}

func validLibraryMode(libraryMode float64) bool {
	return libraryMode == 0 || libraryMode == 1
}

// usernameInUse is the name of the account in use that a username belongs to, whatever its capitals: the same name
// first, else the only one that differs in capitals alone. Empty when there's none
func usernameInUse(ctx context.Context, query interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, username string) (string, error) {
	rows, err := query.QueryContext(ctx, `SELECT username FROM users WHERE status = ?`, db.StatusNormal)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var alike []string
	for rows.Next() {
		var existing string
		if err := rows.Scan(&existing); err != nil {
			return "", err
		}
		if existing == username {
			return existing, nil
		}
		if strings.EqualFold(existing, username) {
			alike = append(alike, existing)
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	// Two accounts from before the rule that differ only in capitals are each signed in to by their own spelling
	if len(alike) == 1 {
		return alike[0], nil
	}
	return "", nil
}

// Account is an account as the admins' list of them has it
type Account struct {
	CreatedAt JSTime `json:"createdAt"`
	ID        string `json:"id"`
	// The library's owner, who can't be deleted or made an ordinary user
	IsSuper        bool    `json:"isSuper"`
	LastActivityAt *JSTime `json:"lastActivityAt"`
	LibraryMode    int     `json:"libraryMode"`
	Role           string  `json:"role"`
	Username       string  `json:"username"`
}

// Accounts is every account in use, oldest first, each with when any of its sessions was last used. Only for admins
func Accounts(ctx context.Context, database *sql.DB, user *User) ([]Account, error) {
	ownerID, err := assertIsAdmin(ctx, database, user)
	if err != nil {
		return nil, err
	}
	rows, err := database.QueryContext(ctx, `
		SELECT users.created_at, users.id, max(sessions.last_activity_at), users.library_mode, users.role, users.username
		FROM users LEFT JOIN sessions ON sessions.user_id = users.id
		WHERE users.status = ? GROUP BY users.id ORDER BY users.created_at ASC`, db.StatusNormal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := []Account{}
	for rows.Next() {
		var (
			account   Account
			createdAt int64
			activity  sql.NullInt64
		)
		if err := rows.Scan(&createdAt, &account.ID, &activity, &account.LibraryMode, &account.Role, &account.Username); err != nil {
			return nil, err
		}
		account.CreatedAt = JSTime(db.Time(createdAt))
		account.Role = Role(account.Role)
		account.LibraryMode = 0
		if account.Role == RolePlayer {
			account.LibraryMode = 1
		}
		account.IsSuper = account.ID == ownerID
		if activity.Valid {
			when := JSTime(db.Time(activity.Int64))
			account.LastActivityAt = &when
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

// AddAccount adds an account for someone else, with the role named or the one its library mode stands for (see
// roleFor). Only for admins
func AddAccount(ctx context.Context, database *sql.DB, admin *User, username, password, role string, libraryMode *float64, authMode string, client Client) (*User, error) {
	if _, err := assertIsAdmin(ctx, database, admin); err != nil {
		return nil, err
	}
	role, err := roleFor(role, libraryMode)
	if err != nil {
		return nil, err
	}
	return CreateUser(ctx, database, username, password, role, authMode, client)
}

// AccountChanges is what an admin changes about an account; what's nil stays as it is
type AccountChanges struct {
	// From a page that still sends it: 0 makes a player a contributor and 1 a contributor a player
	LibraryMode *float64
	Role        *string
	Username    *string
}

// UpdateAccount changes an account's library, role or name. Only for admins. The owner keeps their own library and
// their role, though they can be renamed
func UpdateAccount(ctx context.Context, database *sql.DB, admin *User, id string, changes AccountChanges) (*User, error) {
	ownerID, err := assertIsAdmin(ctx, database, admin)
	if err != nil {
		return nil, err
	}
	if id == ownerID && (changes.LibraryMode != nil || changes.Role != nil) {
		return nil, failure.New(http.StatusUnprocessableEntity, "The owner stays an admin")
	}
	var role string
	if changes.Role != nil {
		if *changes.Role == "" {
			return nil, failure.New(http.StatusBadRequest, "Role must be player, contributor or admin")
		}
		if role, err = roleFor(*changes.Role, nil); err != nil {
			return nil, err
		}
	} else if changes.LibraryMode != nil {
		if role, err = roleFor("", changes.LibraryMode); err != nil {
			return nil, err
		}
	}
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer transaction.Rollback()
	var updated User
	err = transaction.QueryRowContext(ctx,
		`SELECT id, role, username FROM users WHERE id = ? AND status = ? LIMIT 1`, id, db.StatusNormal).
		Scan(&updated.ID, &updated.Role, &updated.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, failure.New(http.StatusNotFound, "User not found")
	}
	if err != nil {
		return nil, err
	}
	if changes.Username != nil {
		username := strings.TrimSpace(*changes.Username)
		if !ValidUsername(username) {
			return nil, errInvalidUsername
		}
		// Taken by someone else, whatever its capitals; an account may change the capitals of its own
		existing, err := usernameInUse(ctx, transaction, username)
		if err != nil {
			return nil, err
		}
		if existing != "" && existing != updated.Username {
			return nil, failure.New(http.StatusConflict, "Username already exists")
		}
		updated.Username = username
	}
	// A library mode alone leaves an admin an admin: it only ever told players from contributors
	if role != "" && (changes.Role != nil || Role(updated.Role) != RoleAdmin) {
		updated.Role = role
	}
	updated.withRole(updated.Role)
	if _, err := transaction.ExecContext(ctx,
		`UPDATE users SET library_mode = ?, role = ?, username = ?, updated_at = ? WHERE id = ?`,
		updated.LibraryMode, updated.Role, updated.Username, db.Millis(time.Now()), id); err != nil {
		return nil, err
	}
	return &updated, transaction.Commit()
}

// endAccount marks an account deleted and ends its sessions; what it kept is removed by whoever called
func endAccount(ctx context.Context, database *sql.DB, id string) error {
	now := db.Millis(time.Now())
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `UPDATE users SET status = ?, updated_at = ? WHERE id = ?`,
		db.StatusDeleted, now, id); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
		return err
	}
	// Its sign-in elsewhere may make a new account later
	if _, err := transaction.ExecContext(ctx, `DELETE FROM oidc_identities WHERE user_id = ?`, id); err != nil {
		return err
	}
	return transaction.Commit()
}

// DeleteAccount deletes another account and ends its sessions. Only for admins, not for themselves (see
// DeleteOwnAccount), and never the owner
func DeleteAccount(ctx context.Context, database *sql.DB, admin *User, id string) error {
	ownerID, err := assertIsAdmin(ctx, database, admin)
	if err != nil {
		return err
	}
	if id == admin.ID {
		return failure.New(http.StatusUnprocessableEntity, "Cannot delete yourself")
	}
	if id == ownerID {
		return failure.New(http.StatusUnprocessableEntity, "Cannot delete the library's owner")
	}
	var found string
	err = database.QueryRowContext(ctx, `SELECT id FROM users WHERE id = ? AND status = ? LIMIT 1`, id, db.StatusNormal).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return failure.New(http.StatusNotFound, "User not found")
	}
	if err != nil {
		return err
	}
	return endAccount(ctx, database, id)
}

// DeleteOwnAccount deletes the signed-in user's account, once their password is checked where there are passwords.
// Not for the owner, whose library others may share
func DeleteOwnAccount(ctx context.Context, database *sql.DB, user *User, password, authMode string) error {
	ownerID, err := AdminID(ctx, database)
	if err != nil {
		return err
	}
	if user.ID == ownerID {
		return failure.New(http.StatusUnprocessableEntity, "Cannot delete the library's owner")
	}
	if authMode == "local" {
		var passwordHash sql.NullString
		if err := database.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = ? LIMIT 1`, user.ID).Scan(&passwordHash); err != nil {
			return err
		}
		valid := false
		if passwordHash.Valid && passwordHash.String != "" {
			if valid, err = VerifyPassword(ctx, passwordHash.String, password); err != nil {
				return err
			}
		}
		if !valid {
			return failure.New(http.StatusUnauthorized, "Invalid current password")
		}
	}
	return endAccount(ctx, database, user.ID)
}

// SessionInfo is one of the user's sessions as they see it: a device they're signed in on
type SessionInfo struct {
	CreatedAt      JSTime  `json:"createdAt"`
	Current        bool    `json:"current"`
	ID             string  `json:"id"`
	IP             *string `json:"ip"`
	LastActivityAt JSTime  `json:"lastActivityAt"`
	UserAgent      *string `json:"userAgent"`
}

// Sessions is where the user is signed in, the most recently used first. The token tells which is this one
func Sessions(ctx context.Context, database *sql.DB, user *User, token string) ([]SessionInfo, error) {
	rows, err := database.QueryContext(ctx, `
		SELECT created_at, token = ?, id, ip, last_activity_at, user_agent FROM sessions
		WHERE user_id = ? AND status = ? AND expires_at > ? ORDER BY last_activity_at DESC`,
		token, user.ID, db.StatusNormal, db.Millis(time.Now()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []SessionInfo{}
	for rows.Next() {
		var (
			session                 SessionInfo
			createdAt, lastActivity int64
			ip, userAgent           sql.NullString
		)
		if err := rows.Scan(&createdAt, &session.Current, &session.ID, &ip, &lastActivity, &userAgent); err != nil {
			return nil, err
		}
		session.CreatedAt, session.LastActivityAt = JSTime(db.Time(createdAt)), JSTime(db.Time(lastActivity))
		session.IP, session.UserAgent = optional(ip.String), optional(userAgent.String)
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// EndOtherSessions signs the user out everywhere but where they asked from, and is how many sessions ended
func EndOtherSessions(ctx context.Context, database *sql.DB, user *User, token string) (int64, error) {
	result, err := database.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token != ?`, user.ID, token)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// RemoveEndedSessions forgets the sessions that were signed out of or have expired, which nothing reads again, and
// is how many there were
func RemoveEndedSessions(ctx context.Context, database *sql.DB) (int64, error) {
	result, err := database.ExecContext(ctx, `DELETE FROM sessions WHERE status != ? OR expires_at <= ?`,
		db.StatusNormal, db.Millis(time.Now()))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ResetPassword gives another account a new password, for someone who forgot theirs, and ends its sessions. Only for
// the admin, who changes their own with their current one
func ResetPassword(ctx context.Context, database *sql.DB, admin *User, id, newPassword, authMode string) error {
	if authMode != "local" {
		return failure.New(http.StatusForbidden, "Password changes are unavailable with external authentication")
	}
	ownerID, err := assertIsAdmin(ctx, database, admin)
	if err != nil {
		return err
	}
	// Nor the owner's, by another admin: that would hand them the library
	if id == admin.ID || id == ownerID {
		return failure.New(http.StatusUnprocessableEntity, "Change your own password with your current one")
	}
	var found string
	err = database.QueryRowContext(ctx, `SELECT id FROM users WHERE id = ? AND status = ? LIMIT 1`, id, db.StatusNormal).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return failure.New(http.StatusNotFound, "User not found")
	}
	if err != nil {
		return err
	}
	if utf8.RuneCountInString(newPassword) < MinPasswordLength {
		return errPasswordTooShort
	}
	hash, err := HashPassword(ctx, newPassword)
	if err != nil {
		return err
	}
	now := db.Millis(time.Now())
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, hash, now, id); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE user_id = ? AND status = ?`,
		db.StatusDeleted, now, id, db.StatusNormal); err != nil {
		return err
	}
	return transaction.Commit()
}
