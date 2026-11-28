package library

import (
	"context"
	"database/sql"
	"path"

	"retroassembly/server/internal/files"
)

// RemoveAccountRows removes, in the transaction that deletes an account, what it kept: its save states, its games' own
// saves, its favorites and its play history, all of it, and is the ids of the files to remove once the transaction is
// done (see RemoveAccountFiles). The games are the server's, and stay. The account's settings are the caller's to
// remove. Nothing is kept of the play history: no list of games or count reads another account's, so it would only
// be a record of what someone who left played, and when
func RemoveAccountRows(ctx context.Context, transaction *sql.Tx, userID string) ([]string, error) {
	var fileIDs []string
	for table, columns := range map[string]string{"game_saves": "file_id", "states": "file_id, thumbnail_file_id"} {
		removed, err := textValues(ctx, transaction, `DELETE FROM `+table+` WHERE user_id = ? RETURNING `+columns, userID)
		if err != nil {
			return nil, err
		}
		fileIDs = append(fileIDs, removed...)
	}
	for _, table := range []string{"favorites", "launch_records"} {
		if _, err := transaction.ExecContext(ctx, `DELETE FROM `+table+` WHERE user_id = ?`, userID); err != nil {
			return nil, err
		}
	}
	return fileIDs, nil
}

// RemoveAccountFiles removes a deleted account's files: those its rows named, and its folders of states and game
// saves with whatever else is in them. A file that can't be removed is left, as the account is already gone
func RemoveAccountFiles(storage files.Storage, userID string, fileIDs []string) {
	for _, fileID := range fileIDs {
		storage.Delete(fileID)
	}
	// Only a real account's folders: an empty or odd id would name the whole folder of states, or another's
	if userID == "" || path.Base(userID) != userID || userID == "." || userID == ".." {
		return
	}
	for _, folder := range []string{"states", "game-saves"} {
		storage.DeleteFolder(path.Join(folder, userID))
	}
}

// textValues is every text value a query answers, row by row, skipping empty ones
func textValues(ctx context.Context, query interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sqlText string, arguments ...any) ([]string, error) {
	rows, err := query.QueryContext(ctx, sqlText, arguments...)
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
