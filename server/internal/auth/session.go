// Package auth signs users in and out, as src/controllers/sessions and src/controllers/users do.
package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/ids"
)

var errInvalidLogin = failure.New(http.StatusUnauthorized, "Invalid username or password")

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
	ID          string `json:"id"`
	LibraryMode int    `json:"libraryMode"`
	Username    string `json:"username"`
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

// CurrentUser is whoever the token belongs to, or nil. A session still in use is kept going: its last activity is
// noted every 5 minutes, and a password session within a day of expiring is given another 30 days
func CurrentUser(ctx context.Context, database *sql.DB, token, authMode string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	method := MethodPassword
	if authMode == "oidc" {
		method = MethodOIDC
	}
	now := time.Now()
	var (
		sessionID               string
		expiresAt, lastActivity int64
		user                    User
	)
	err := database.QueryRowContext(ctx, `
		SELECT s.id, s.expires_at, s.last_activity_at, u.id, u.library_mode, u.username
		FROM sessions s INNER JOIN users u ON s.user_id = u.id
		WHERE s.token = ? AND s.status = ? AND u.status = ? AND s.authentication_method = ? AND s.expires_at > ?
		LIMIT 1`,
		token, db.StatusNormal, db.StatusNormal, method, db.Millis(now),
	).Scan(&sessionID, &expiresAt, &lastActivity, &user.ID, &user.LibraryMode, &user.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	newExpiresAt, newLastActivity := db.Time(expiresAt), db.Time(lastActivity)
	update := false
	if method == MethodPassword && newExpiresAt.Sub(now) <= 24*time.Hour {
		newExpiresAt = inThirtyDays(now)
		update = true
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
			return nil, err
		}
	}
	return &user, nil
}

// CreateSession starts a session for a user, with a new token
func CreateSession(ctx context.Context, database *sql.DB, userID, method string, expiresAt time.Time, client Client) (*Session, error) {
	now := time.Now()
	session := Session{
		AuthenticationMethod: method,
		ExpiresAt:            JSTime(expiresAt),
		IP:                   optional(client.IP),
		LastActivityAt:       JSTime(now),
		Token:                ids.New(),
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
	err := database.QueryRowContext(ctx,
		`SELECT id, library_mode, username, password_hash FROM users WHERE username = ? AND status = ? LIMIT 1`,
		strings.TrimSpace(username), db.StatusNormal,
	).Scan(&user.ID, &user.LibraryMode, &user.Username, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errInvalidLogin
	}
	if err != nil {
		return nil, nil, err
	}
	if !passwordHash.Valid || passwordHash.String == "" {
		return nil, nil, errInvalidLogin
	}
	valid, err := VerifyPassword(passwordHash.String, password)
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

// CreateUser adds an account, with its own library (libraryMode 0) or the admin's (1). With passwords, a password is
// needed; with OIDC, there are none
func CreateUser(ctx context.Context, database *sql.DB, username, password string, libraryMode int, authMode string, client Client) (*User, error) {
	username = strings.TrimSpace(username)
	var existing string
	err := database.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ? AND status = ? LIMIT 1`,
		username, db.StatusNormal).Scan(&existing)
	if err == nil {
		return nil, failure.New(http.StatusConflict, "Username already exists")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if authMode == "local" && password == "" {
		return nil, failure.New(http.StatusBadRequest, "Password is required")
	}
	if authMode == "oidc" && password != "" {
		return nil, failure.New(http.StatusBadRequest, "Passwords are unavailable with OIDC authentication")
	}
	var passwordHash *string
	if password != "" {
		hash, err := HashPassword(password)
		if err != nil {
			return nil, err
		}
		passwordHash = &hash
	}
	now := db.Millis(time.Now())
	user := User{ID: ids.New(), LibraryMode: libraryMode, Username: username}
	_, err = database.ExecContext(ctx, `
		INSERT INTO users (library_mode, password_hash, registration_ip, registration_user_agent, username, created_at,
			id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.LibraryMode, passwordHash, optional(client.IP), optional(client.UserAgent), username, now, user.ID,
		db.StatusNormal, now,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// LibraryOwnerID is whose library the user sees: their own, or the admin's (the oldest account still in use) for an
// account that shares the admin's library
func LibraryOwnerID(ctx context.Context, database *sql.DB, user *User) (string, error) {
	const shared = 1
	if user.LibraryMode != shared {
		return user.ID, nil
	}
	var adminID string
	err := database.QueryRowContext(ctx,
		`SELECT id FROM users WHERE status = ? ORDER BY created_at ASC LIMIT 1`, db.StatusNormal).Scan(&adminID)
	if errors.Is(err, sql.ErrNoRows) {
		return user.ID, nil
	}
	if err != nil {
		return "", err
	}
	return adminID, nil
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
		if valid, err = VerifyPassword(passwordHash.String, currentPassword); err != nil {
			return err
		}
	}
	if !valid {
		return failure.New(http.StatusUnauthorized, "Invalid current password")
	}
	newHash, err := HashPassword(newPassword)
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
