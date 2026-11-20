// Package library is the games a user sees and what they do with them, as src/controllers and
// src/utils/server/library-scope.ts do. There are two kinds of data:
//   - the library (games and their artwork) belongs to the library owner: the user, or the admin for an account that
//     shares the admin's library. A shared account can read it but not change it
//   - personal data (saves, favorites, play history, settings) belongs to the user, whether or not they share a library
package library

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/ids"
)

// Scope is everything needed to act for the signed-in user
type Scope struct {
	Database       *sql.DB
	LibraryOwnerID string
	// How many automatic save states are kept for each game
	MaxAutoStates int
	Storage       files.Storage
	User          *auth.User
}

// SharesLibrary tells whether the user sees someone else's library, which they may only read
func (s Scope) SharesLibrary() bool {
	const shared = 1
	return s.User.LibraryMode == shared
}

// Rom is the little a write needs to know about a game
type Rom struct {
	ID       string
	Platform string
}

var errRomNotFound = failure.New(http.StatusNotFound, "ROM not found")

// FindRom is a game in the user's library; anyone else's is treated as not there
func FindRom(ctx context.Context, scope Scope, id string) (Rom, error) {
	var rom Rom
	err := scope.Database.QueryRowContext(ctx,
		`SELECT id, platform FROM roms WHERE user_id = ? AND status = ? AND id = ? LIMIT 1`,
		scope.LibraryOwnerID, db.StatusNormal, id,
	).Scan(&rom.ID, &rom.Platform)
	if errors.Is(err, sql.ErrNoRows) {
		return Rom{}, errRomNotFound
	}
	return rom, err
}

// Favorite is a favorites row, as the API answers it, in the order of the Node server's columns
type Favorite struct {
	RomID     string      `json:"romId"`
	UserID    string      `json:"userId"`
	CreatedAt auth.JSTime `json:"createdAt"`
	ID        string      `json:"id"`
	Status    int         `json:"status"`
	UpdatedAt auth.JSTime `json:"updatedAt"`
}

func scanFavorite(scanner interface{ Scan(...any) error }) (*Favorite, error) {
	var (
		favorite             Favorite
		createdAt, updatedAt int64
	)
	if err := scanner.Scan(&favorite.RomID, &favorite.UserID, &createdAt, &favorite.ID, &favorite.Status, &updatedAt); err != nil {
		return nil, err
	}
	favorite.CreatedAt, favorite.UpdatedAt = auth.JSTime(db.Time(createdAt)), auth.JSTime(db.Time(updatedAt))
	return &favorite, nil
}

const favoriteColumns = `rom_id, user_id, created_at, id, status, updated_at`

// AddFavorite marks a game in the library as a favorite, bringing back one that was removed
func AddFavorite(ctx context.Context, scope Scope, romID string) (*Favorite, error) {
	if _, err := FindRom(ctx, scope, romID); err != nil {
		return nil, err
	}
	existing, err := scanFavorite(scope.Database.QueryRowContext(ctx,
		`SELECT `+favoriteColumns+` FROM favorites WHERE user_id = ? AND rom_id = ?`, scope.User.ID, romID))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	now := db.Millis(time.Now())
	switch {
	case existing != nil && existing.Status == db.StatusNormal:
		return existing, nil
	case existing != nil:
		return scanFavorite(scope.Database.QueryRowContext(ctx,
			`UPDATE favorites SET status = ?, updated_at = ? WHERE id = ? RETURNING `+favoriteColumns,
			db.StatusNormal, now, existing.ID))
	}
	return scanFavorite(scope.Database.QueryRowContext(ctx,
		`INSERT INTO favorites (rom_id, user_id, created_at, id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		RETURNING `+favoriteColumns,
		romID, scope.User.ID, now, ids.New(), db.StatusNormal, now))
}

// RemoveFavorite unmarks a favorite
func RemoveFavorite(ctx context.Context, scope Scope, romID string) error {
	_, err := scope.Database.ExecContext(ctx,
		`UPDATE favorites SET status = ?, updated_at = ? WHERE rom_id = ? AND user_id = ? AND status = ?`,
		db.StatusDeleted, db.Millis(time.Now()), romID, scope.User.ID, db.StatusNormal)
	return err
}

// AddLaunchRecord notes that the user started a game, with which emulator
func AddLaunchRecord(ctx context.Context, scope Scope, romID, core string) error {
	rom, err := FindRom(ctx, scope, romID)
	if err != nil {
		return err
	}
	now := db.Millis(time.Now())
	_, err = scope.Database.ExecContext(ctx, `
		INSERT INTO launch_records (core, platform, rom_id, user_id, created_at, id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		core, rom.Platform, rom.ID, scope.User.ID, now, ids.New(), db.StatusNormal, now)
	return err
}

// RemoveLaunchRecords takes a game off the user's play history
func RemoveLaunchRecords(ctx context.Context, scope Scope, romID string) error {
	_, err := scope.Database.ExecContext(ctx,
		`UPDATE launch_records SET status = ?, updated_at = ? WHERE rom_id = ? AND user_id = ? AND status = ?`,
		db.StatusDeleted, db.Millis(time.Now()), romID, scope.User.ID, db.StatusNormal)
	return err
}
