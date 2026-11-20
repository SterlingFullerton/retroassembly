package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
)

// AdminID is the admin's account: the oldest one still in use. Empty when there are no accounts
func AdminID(ctx context.Context, database *sql.DB) (string, error) {
	var id string
	err := database.QueryRowContext(ctx,
		`SELECT id FROM users WHERE status = ? ORDER BY created_at ASC LIMIT 1`, db.StatusNormal).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// assertIsAdmin refuses anyone but the admin, and is the admin's id
func assertIsAdmin(ctx context.Context, database *sql.DB, user *User) (string, error) {
	adminID, err := AdminID(ctx, database)
	if err != nil {
		return "", err
	}
	if adminID != user.ID {
		return "", failure.Forbidden
	}
	return adminID, nil
}

// Account is an account as the admin's list of them has it
type Account struct {
	CreatedAt      JSTime  `json:"createdAt"`
	ID             string  `json:"id"`
	IsSuper        bool    `json:"isSuper"`
	LastActivityAt *JSTime `json:"lastActivityAt"`
	LibraryMode    int     `json:"libraryMode"`
	Username       string  `json:"username"`
}

// Accounts is every account in use, oldest first, each with when any of its sessions was last used. Only for the admin
func Accounts(ctx context.Context, database *sql.DB, user *User) ([]Account, error) {
	adminID, err := assertIsAdmin(ctx, database, user)
	if err != nil {
		return nil, err
	}
	rows, err := database.QueryContext(ctx, `
		SELECT users.created_at, users.id, sessions.last_activity_at, users.library_mode, users.username
		FROM users LEFT JOIN sessions ON sessions.user_id = users.id
		WHERE users.status = ? ORDER BY users.created_at ASC`, db.StatusNormal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := []Account{}
	index := map[string]int{}
	lastActivity := map[string]int64{}
	for rows.Next() {
		var (
			account   Account
			createdAt int64
			activity  sql.NullInt64
		)
		if err := rows.Scan(&createdAt, &account.ID, &activity, &account.LibraryMode, &account.Username); err != nil {
			return nil, err
		}
		account.CreatedAt = JSTime(db.Time(createdAt))
		account.IsSuper = account.ID == adminID
		if activity.Valid {
			when := JSTime(db.Time(activity.Int64))
			account.LastActivityAt = &when
		}
		// The most recent activity of each account, in the order the accounts were first met
		i, seen := index[account.ID]
		switch {
		case !seen:
			index[account.ID] = len(accounts)
			accounts = append(accounts, account)
		case activity.Valid && (accounts[i].LastActivityAt == nil || activity.Int64 > lastActivity[account.ID]):
			accounts[i] = account
		default:
			continue
		}
		if activity.Valid {
			lastActivity[account.ID] = activity.Int64
		}
	}
	return accounts, rows.Err()
}

// AddAccount adds an account for someone else. Only for the admin
func AddAccount(ctx context.Context, database *sql.DB, admin *User, username, password string, libraryMode int, authMode string, client Client) (*User, error) {
	adminID, err := AdminID(ctx, database)
	if err != nil {
		return nil, err
	}
	if adminID == "" || adminID != admin.ID {
		return nil, failure.Forbidden
	}
	return CreateUser(ctx, database, username, password, libraryMode, authMode, client)
}

// SetLibraryMode gives an account its own library (0) or the admin's (1). Only for the admin, and not for their own
func SetLibraryMode(ctx context.Context, database *sql.DB, admin *User, id string, libraryMode float64) (*User, error) {
	adminID, err := assertIsAdmin(ctx, database, admin)
	if err != nil {
		return nil, err
	}
	if id == adminID {
		return nil, failure.New(http.StatusUnprocessableEntity, "Cannot modify super user")
	}
	var updated User
	err = database.QueryRowContext(ctx,
		`UPDATE users SET library_mode = ?, updated_at = ? WHERE id = ? RETURNING id, library_mode, username`,
		libraryMode, db.Millis(time.Now()), id).Scan(&updated.ID, &updated.LibraryMode, &updated.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, failure.New(http.StatusNotFound, "User not found")
	}
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

// DeleteAccount deletes another account and ends its sessions. Only for the admin, and not for themselves
func DeleteAccount(ctx context.Context, database *sql.DB, admin *User, id string) error {
	adminID, err := assertIsAdmin(ctx, database, admin)
	if err != nil {
		return err
	}
	if id == admin.ID {
		return failure.New(http.StatusUnprocessableEntity, "Cannot delete yourself")
	}
	if id == adminID {
		return failure.New(http.StatusUnprocessableEntity, "Cannot delete super user")
	}
	now := db.Millis(time.Now())
	if _, err := database.ExecContext(ctx, `UPDATE users SET status = ?, updated_at = ? WHERE id = ?`,
		db.StatusDeleted, now, id); err != nil {
		return err
	}
	_, err = database.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE user_id = ? AND status = ?`,
		db.StatusDeleted, now, id, db.StatusNormal)
	return err
}
