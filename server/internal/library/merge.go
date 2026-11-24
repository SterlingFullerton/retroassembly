package library

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/files"
)

// MergeLibraries brings the games accounts kept in libraries of their own, from before the server had one for all,
// into the server's: each is moved under the library's account, unless the library already has a game with its file
// name on that console, in which case that one stands for it, and the saves, favorites and history of the other follow
// it there. It's how many games were moved and how many stood in for. With nothing left to bring in, as on every
// start after the first, it does nothing
func MergeLibraries(ctx context.Context, database *sql.DB, storage files.Storage) (moved, replaced int, err error) {
	ownerID, err := auth.AdminID(ctx, database)
	if err != nil || ownerID == "" {
		return 0, 0, err
	}
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer transaction.Rollback()

	type game struct{ id, platform, fileName, fileID string }
	rows, err := transaction.QueryContext(ctx,
		`SELECT id, platform, file_name, file_id FROM roms WHERE status = ? AND user_id != ? ORDER BY created_at ASC`,
		db.StatusNormal, ownerID)
	if err != nil {
		return 0, 0, err
	}
	var games []game
	for rows.Next() {
		var each game
		if err := rows.Scan(&each.id, &each.platform, &each.fileName, &each.fileID); err != nil {
			rows.Close()
			return 0, 0, err
		}
		games = append(games, each)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(games) == 0 {
		return 0, 0, err
	}

	now := db.Millis(time.Now())
	var unusedFiles []string
	for _, each := range games {
		var kept string
		err := transaction.QueryRowContext(ctx,
			`SELECT id FROM roms WHERE user_id = ? AND platform = ? AND status = ? AND file_name = ? LIMIT 1`,
			ownerID, each.platform, db.StatusNormal, each.fileName).Scan(&kept)
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := transaction.ExecContext(ctx, `UPDATE roms SET user_id = ?, updated_at = ? WHERE id = ?`,
				ownerID, now, each.id); err != nil {
				return 0, 0, err
			}
			moved++
			continue
		}
		if err != nil {
			return 0, 0, err
		}
		// The library's own game stands for this one. Someone with both as favorites keeps the one
		for _, statement := range []string{
			`UPDATE states SET rom_id = ?1 WHERE rom_id = ?2`,
			`UPDATE game_saves SET rom_id = ?1 WHERE rom_id = ?2`,
			`UPDATE launch_records SET rom_id = ?1 WHERE rom_id = ?2`,
			`UPDATE OR IGNORE favorites SET rom_id = ?1 WHERE rom_id = ?2`,
			`DELETE FROM favorites WHERE rom_id = ?2`,
		} {
			if _, err := transaction.ExecContext(ctx, statement, kept, each.id); err != nil {
				return 0, 0, err
			}
		}
		if _, err := transaction.ExecContext(ctx, `UPDATE roms SET status = ?, updated_at = ? WHERE id = ?`,
			db.StatusDeleted, now, each.id); err != nil {
			return 0, 0, err
		}
		unusedFiles = append(unusedFiles, each.fileID)
		replaced++
	}
	if err := transaction.Commit(); err != nil {
		return 0, 0, err
	}
	// A stood-in-for game's file goes if it was other content than the library's and nothing else uses it
	err = RemoveUnusedRomFiles(ctx, Scope{Database: database, Storage: storage}, unusedFiles)
	return moved, replaced, err
}
