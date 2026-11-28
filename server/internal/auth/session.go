// Package auth signs users in and out, as src/controllers/sessions and src/controllers/users do.
package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/ids"
)

var errInvalidLogin = failure.New(http.StatusUnauthorized, "Invalid username or password")

// A hash no password matches, with the settings of the app's own, to check a sign-in against when there's no account
const unknownUserHash = "$argon2id$v=19$m=65536,t=3,p=4$c2lnbi1pbi13aXRob3V0LWFuLWFjY291bnQ$" +
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

const (
	MethodOIDC     = "oidc"
	MethodPassword = "password"
)

// JSTime is a time written in JSON as JavaScript's Date.prototype.toISOString writes it
type JSTime time.Time

func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// User is the signed-in user, as the API answers it
type User struct {
	ID string `json:"id"`
	// What pages from before there were roles read instead of the role: 1 for a player, who can't change the library
	LibraryMode int `json:"libraryMode"`
	// "player", "contributor" or "admin" (see RolePlayer)
	Role     string `json:"role"`
	Username string `json:"username"`
}

// Session is a sessions row, as the API answers it, in the order of the Node server's columns
type Session struct {
	AuthenticationMethod string  `json:"authenticationMethod"`
	ExpiresAt            JSTime  `json:"expiresAt"`
	IP                   *string `json:"ip"`
	LastActivityAt       JSTime  `json:"lastActivityAt"`
	Token                string  `json:"token"`
	UserAgent            *string `json:"userAgent"`
	UserID               string  `json:"userId"`
	CreatedAt            JSTime  `json:"createdAt"`
	ID                   string  `json:"id"`
	Status               int     `json:"status"`
	UpdatedAt            JSTime  `json:"updatedAt"`
}

// Client is who a session or an account is made for
type Client struct {
	IP        string
	UserAgent string
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// Token is the session token a request carries: "Authorization: Bearer <token>", or the token cookie
func Token(r *http.Request) string {
	if token := strings.Replace(r.Header.Get("Authorization"), "Bearer ", "", 1); token != "" {
		return token
	}
	if cookie, err := r.Cookie("token"); err == nil {
		return cookie.Value
	}
	return ""
}

// The Node server adds days by the calendar, in the server's own time zone
func inThirtyDays(now time.Time) time.Time {
	return now.AddDate(0, 0, 30)
}

// A password session renews itself while it's used, but not past this long after signing in, so a token taken from
// a browser stops working in the end, however it's used
const maxPasswordSessionAge = 90 * 24 * time.Hour

// newToken is a session token: 32 random bytes, which can't be guessed
func newToken() string {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(token)
}

// CurrentUser is whoever the token belongs to, or nil. A session still in use is kept going: its last activity is
// noted every 5 minutes, and a password session within a day of expiring is given another 30 days, up to 90 days after
// it started. renewedUntil is when a session given more time now expires, for the browser's cookie to last as long;
// zero otherwise
func CurrentUser(ctx context.Context, database *sql.DB, token, authMode string) (user *User, renewedUntil time.Time, err error) {
	if token == "" {
		return nil, time.Time{}, nil
	}
	method := MethodPassword
	if authMode == "oidc" {
		method = MethodOIDC
	}
	now := time.Now()
	var (
		sessionID                          string
		createdAt, expiresAt, lastActivity int64
		found                              User
	)
	err = database.QueryRowContext(ctx, `
		SELECT s.id, s.created_at, s.expires_at, s.last_activity_at, u.id, u.role, u.username
		FROM sessions s INNER JOIN users u ON s.user_id = u.id
		WHERE s.token = ? AND s.status = ? AND u.status = ? AND s.authentication_method = ? AND s.expires_at > ?
		LIMIT 1`,
		token, db.StatusNormal, db.StatusNormal, method, db.Millis(now),
	).Scan(&sessionID, &createdAt, &expiresAt, &lastActivity, &found.ID, &found.Role, &found.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, time.Time{}, nil
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	found.withRole(found.Role)

	newExpiresAt, newLastActivity := db.Time(expiresAt), db.Time(lastActivity)
	update := false
	if method == MethodPassword && newExpiresAt.Sub(now) <= 24*time.Hour {
		renewed := inThirtyDays(now)
		if latest := db.Time(createdAt).Add(maxPasswordSessionAge); renewed.After(latest) {
			renewed = latest
		}
		if renewed.After(newExpiresAt) {
			newExpiresAt, renewedUntil = renewed, renewed
			update = true
		}
	}
	if now.Sub(newLastActivity) >= 5*time.Minute {
		newLastActivity = now
		update = true
	}
	if update {
		_, err = database.ExecContext(ctx,
			`UPDATE sessions SET expires_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?`,
			db.Millis(newExpiresAt), db.Millis(newLastActivity), db.Millis(now), sessionID,
		)
		if err != nil {
			return nil, time.Time{}, err
		}
	}
	return &found, renewedUntil, nil
}

// CreateSession starts a session for a user, with a new token
func CreateSession(ctx context.Context, database *sql.DB, userID, method string, expiresAt time.Time, client Client) (*Session, error) {
	now := time.Now()
	session := Session{
		AuthenticationMethod: method,
		ExpiresAt:            JSTime(expiresAt),
		IP:                   optional(client.IP),
		LastActivityAt:       JSTime(now),
		Token:                newToken(),
		UserAgent:            optional(client.UserAgent),
		UserID:               userID,
		CreatedAt:            JSTime(now),
		ID:                   ids.New(),
		Status:               db.StatusNormal,
		UpdatedAt:            JSTime(now),
	}
	_, err := database.ExecContext(ctx, `
		INSERT INTO sessions (authentication_method, expires_at, ip, last_activity_at, token, user_agent, user_id,
			created_at, id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		method, db.Millis(expiresAt), session.IP, db.Millis(now), session.Token, session.UserAgent, userID,
		db.Millis(now), session.ID, session.Status, db.Millis(now),
	)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// Login checks a username and password and starts a 30-day session
func Login(ctx context.Context, database *sql.DB, username, password string, client Client) (*Session, *User, error) {
	var (
		user         User
		passwordHash sql.NullString
	)
	// Capitals don't matter: "Jack" signs in to "jack"
	name, err := usernameInUse(ctx, database, strings.TrimSpace(username))
	if err != nil {
		return nil, nil, err
	}
	err = sql.ErrNoRows
	if name != "" {
		err = database.QueryRowContext(ctx,
			`SELECT id, role, username, password_hash FROM users WHERE username = ? AND status = ? LIMIT 1`,
			name, db.StatusNormal,
		).Scan(&user.ID, &user.Role, &user.Username, &passwordHash)
		user.withRole(user.Role)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, err
	}
	// A username that isn't there, or an account without a password, is checked against a hash all the same, so the
	// answer takes as long and doesn't tell which usernames exist
	if err != nil || !passwordHash.Valid || passwordHash.String == "" {
		if _, err := VerifyPassword(ctx, unknownUserHash, password); err != nil {
			return nil, nil, err
		}
		return nil, nil, errInvalidLogin
	}
	valid, err := VerifyPassword(ctx, passwordHash.String, password)
	if err != nil {
		return nil, nil, err
	}
	if !valid {
		return nil, nil, errInvalidLogin
	}
	session, err := StartPasswordSession(ctx, database, user.ID, client)
	if err != nil {
		return nil, nil, err
	}
	return session, &user, nil
}

// StartPasswordSession starts a 30-day session for a user who signed in with their password
func StartPasswordSession(ctx context.Context, database *sql.DB, userID string, client Client) (*Session, error) {
	return CreateSession(ctx, database, userID, MethodPassword, inThirtyDays(time.Now()), client)
}

// InvalidateSession ends the session a token belongs to
func InvalidateSession(ctx context.Context, database *sql.DB, token string) error {
	if token == "" {
		return nil
	}
	_, err := database.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE token = ?`,
		db.StatusDeleted, db.Millis(time.Now()), token)
	return err
}

// MinPasswordLength is the shortest password a new account or a password change may have. Passwords set before it
// was required still work
const MinPasswordLength = 8

var (
	errPasswordTooShort   = failure.New(http.StatusBadRequest, "Password must be at least 8 characters")
	errRegistrationClosed = failure.New(http.StatusForbidden, "Registration is closed: ask the admin for an account")
)

// CreateUser adds an account with a role, though the first account is always the admin. With passwords, a password is
// needed; with OIDC, there are none
func CreateUser(ctx context.Context, database *sql.DB, username, password, role, authMode string, client Client) (*User, error) {
	return createUser(ctx, database, username, password, role, authMode, client, false)
}

// RegisterFirst adds the first account, which becomes the admin. Once there's an account, the admin adds the others,
// so anyone who can reach the server can't make one for themselves
func RegisterFirst(ctx context.Context, database *sql.DB, username, password, authMode string, client Client) (*User, error) {
	return createUser(ctx, database, username, password, RoleAdmin, authMode, client, true)
}

func hasAccounts(ctx context.Context, query interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (bool, error) {
	var count int
	err := query.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE status = ?`, db.StatusNormal).Scan(&count)
	return count > 0, err
}

func createUser(ctx context.Context, database *sql.DB, username, password, role, authMode string, client Client, firstOnly bool) (*User, error) {
	if firstOnly {
		// Checked before the password is hashed, so refusing costs nothing, and again below with the account added
		if taken, err := hasAccounts(ctx, database); err != nil {
			return nil, err
		} else if taken {
			return nil, errRegistrationClosed
		}
	}
	username = strings.TrimSpace(username)
	// Taken whatever its capitals, so "Jack" can't be added beside "jack"
	existing, err := usernameInUse(ctx, database, username)
	if err != nil {
		return nil, err
	}
	if existing != "" {
		return nil, errUsernameTaken
	}
	if err := checkNewUsername(ctx, database, username, ""); err != nil {
		return nil, err
	}
	if authMode == "local" && password == "" {
		return nil, failure.New(http.StatusBadRequest, "Password is required")
	}
	if authMode == "local" && utf8.RuneCountInString(password) < MinPasswordLength {
		return nil, errPasswordTooShort
	}
	if authMode == "oidc" && password != "" {
		return nil, failure.New(http.StatusBadRequest, "Passwords are unavailable with OIDC authentication")
	}
	var passwordHash *string
	if password != "" {
		hash, err := HashPassword(ctx, password)
		if err != nil {
			return nil, err
		}
		passwordHash = &hash
	}
	// Checked again with the account added in the same transaction: two registrations of one username at once, each
	// waiting for its hash, would otherwise both pass the check above
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer transaction.Rollback()
	if existing, err = usernameInUse(ctx, transaction, username); err != nil {
		return nil, err
	}
	if existing != "" {
		return nil, errUsernameTaken
	}
	if err := checkNewUsername(ctx, transaction, username, ""); err != nil {
		return nil, err
	}
	if firstOnly {
		if taken, err := hasAccounts(ctx, transaction); err != nil {
			return nil, err
		} else if taken {
			return nil, errRegistrationClosed
		}
	}
	// The first account is the admin, and the library's owner
	role, err = firstRole(ctx, transaction, role)
	if err != nil {
		return nil, err
	}
	now := db.Millis(time.Now())
	user := User{ID: ids.New(), Username: username}
	user.withRole(role)
	_, err = transaction.ExecContext(ctx, `
		INSERT INTO users (library_mode, password_hash, registration_ip, registration_user_agent, role, username,
			created_at, id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.LibraryMode, passwordHash, optional(client.IP), optional(client.UserAgent), role, username, now, user.ID,
		db.StatusNormal, now,
	)
	if err != nil {
		return nil, err
	}
	if err := transaction.Commit(); err != nil {
		return nil, err
	}
	return &user, nil
}

// firstRole is the role a new account gets: admin while there's no admin, as for the first account, and the one asked
// for after
func firstRole(ctx context.Context, query interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, role string) (string, error) {
	var admins int
	err := query.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE status = ? AND role = ?`, db.StatusNormal, RoleAdmin).Scan(&admins)
	if err != nil || admins > 0 {
		return Role(role), err
	}
	return RoleAdmin, nil
}

// LibraryOwnerID is the account the server's one library is kept under: its owner, the oldest admin still in use.
// Everyone sees that library; what they may change in it is their role's to say
func LibraryOwnerID(ctx context.Context, database *sql.DB, user *User) (string, error) {
	ownerID, err := AdminID(ctx, database)
	if err != nil {
		return "", err
	}
	if ownerID == "" {
		return user.ID, nil
	}
	return ownerID, nil
}

// UpdatePassword changes the signed-in user's password, once their current one is checked, and ends their other
// sessions; the one they changed it in goes on
func UpdatePassword(ctx context.Context, database *sql.DB, user *User, token, currentPassword, newPassword, authMode string) error {
	if authMode != "local" {
		return failure.New(http.StatusForbidden, "Password changes are unavailable with external authentication")
	}
	var passwordHash sql.NullString
	err := sql.ErrNoRows
	if user != nil {
		err = database.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = ? LIMIT 1`, user.ID).Scan(&passwordHash)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return failure.New(http.StatusNotFound, "User not found")
	}
	if err != nil {
		return err
	}
	valid := false
	if passwordHash.Valid && passwordHash.String != "" {
		if valid, err = VerifyPassword(ctx, passwordHash.String, currentPassword); err != nil {
			return err
		}
	}
	if !valid {
		return failure.New(http.StatusUnauthorized, "Invalid current password")
	}
	if utf8.RuneCountInString(newPassword) < MinPasswordLength {
		return errPasswordTooShort
	}
	newHash, err := HashPassword(ctx, newPassword)
	if err != nil {
		return err
	}
	now := db.Millis(time.Now())
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, newHash, now, user.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE user_id = ?`, db.StatusDeleted, now, user.ID); err != nil {
		return err
	}
	if token != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE token = ? AND user_id = ?`,
			db.StatusNormal, now, token, user.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
