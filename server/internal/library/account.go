package library

import (
	"context"
	"database/sql"
	"path"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/files"
)

// RemoveAccountData removes what a deleted account kept: its save states and their pictures, its games' own saves,
// and its favorites and play history. The games are the server's, and stay. The account's settings are the caller's
// to remove
func RemoveAccountData(ctx context.Context, database *sql.DB, storage files.Storage, userID string) error {
	now := db.Millis(time.Now())

	// Each table's rows are marked deleted, as a single delete marks them, and their files removed
	fileColumns := map[string]string{"game_saves": "file_id", "states": "file_id, thumbnail_file_id"}
	for _, table := range []string{"states", "game_saves"} {
		fileIDs, err := textValues(ctx, database,
			`UPDATE `+table+` SET status = ?, updated_at = ? WHERE user_id = ? AND status = ? RETURNING `+fileColumns[table],
			db.StatusDeleted, now, userID, db.StatusNormal)
		if err != nil {
			return err
		}
		for _, fileID := range fileIDs {
			storage.Delete(fileID)
		}
	}
	for _, table := range []string{"favorites", "launch_records"} {
		if _, err := database.ExecContext(ctx,
			`UPDATE `+table+` SET status = ?, updated_at = ? WHERE user_id = ? AND status = ?`,
			db.StatusDeleted, now, userID, db.StatusNormal); err != nil {
			return err
		}
	}

	// Whatever folders are left empty
	for _, folder := range []string{"states", "game_saves"} {
		storage.DeleteFolder(path.Join(folder, userID))
	}
	return nil
}

// textValues is every text value a query answers, row by row, skipping empty ones
func textValues(ctx context.Context, database *sql.DB, query string, arguments ...any) ([]string, error) {
	rows, err := database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var values []string
	for rows.Next() {
		row := make([]sql.NullString, len(columns))
		targets := make([]any, len(columns))
		for i := range row {
			targets[i] = &row[i]
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		for _, value := range row {
			if value.String != "" {
				values = append(values, value.String)
			}
		}
	}
	return values, rows.Err()
}
