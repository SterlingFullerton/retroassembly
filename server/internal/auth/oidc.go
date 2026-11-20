package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/ids"
)

// OIDCUser is the account an OIDC identity signs in to, as src/controllers/users/get-or-create-oidc-user.ts finds it:
// the one already linked to the identity; else the account with its username, which gets linked to it; else a new
// account, without a password
//
// An account with a password is only linked when linkPasswordAccounts is set
// (RETROASSEMBLY_RUN_TIME_OIDC_LINK_PASSWORD_ACCOUNTS), as when a library kept with passwords moves to OIDC: on a
// provider where users choose their own username, anyone could otherwise take over the account named like theirs,
// the admin's among them
func OIDCUser(ctx context.Context, database *sql.DB, issuer, subject, username string, client Client, linkPasswordAccounts bool) (string, error) {
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer transaction.Rollback()

	var (
		userID string
		status int
	)
	err = transaction.QueryRowContext(ctx, `
		SELECT u.id, u.status FROM oidc_identities i INNER JOIN users u ON i.user_id = u.id
		WHERE i.issuer = ? AND i.subject = ? LIMIT 1`, issuer, subject).Scan(&userID, &status)
	if err == nil {
		if status != db.StatusNormal {
			return "", failure.New(http.StatusForbidden, "This account is no longer active")
		}
		return userID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	now := db.Millis(time.Now())
	link := func(userID string) error {
		_, err := transaction.ExecContext(ctx, `
			INSERT INTO oidc_identities (issuer, subject, user_id, created_at, id, status, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, issuer, subject, userID, now, ids.New(), db.StatusNormal, now)
		return err
	}

	var passwordHash sql.NullString
	err = transaction.QueryRowContext(ctx, `SELECT id, password_hash FROM users WHERE username = ? AND status = ? LIMIT 1`,
		username, db.StatusNormal).Scan(&userID, &passwordHash)
	switch {
	case err == nil:
		if passwordHash.Valid && passwordHash.String != "" && !linkPasswordAccounts {
			return "", failure.New(http.StatusConflict, "This username belongs to an account with a password")
		}
		var linked string
		err = transaction.QueryRowContext(ctx, `SELECT id FROM oidc_identities WHERE user_id = ? LIMIT 1`, userID).
			Scan(&linked)
		if err == nil {
			return "", failure.New(http.StatusConflict, "This username belongs to another OIDC identity")
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	case errors.Is(err, sql.ErrNoRows):
		userID = ids.New()
		_, err = transaction.ExecContext(ctx, `
			INSERT INTO users (library_mode, password_hash, registration_ip, registration_user_agent, username, created_at,
				id, status, updated_at)
			VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
			0, optional(client.IP), optional(client.UserAgent), username, now, userID, db.StatusNormal, now)
		if err != nil {
			return "", err
		}
	default:
		return "", err
	}
	if err := link(userID); err != nil {
		return "", err
	}
	return userID, transaction.Commit()
}
