package library

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/ids"
)

// CountRoms is how many games the library has
func CountRoms(ctx context.Context, scope Scope) (int64, error) {
	var count int64
	err := scope.Database.QueryRowContext(ctx, `SELECT count(*) FROM roms WHERE user_id = ? AND status = ?`,
		scope.LibraryOwnerID, db.StatusNormal).Scan(&count)
	return count, err
}

// RomField is a column of a game and the value it's set to
type RomField struct {
	Column string
	Value  any
}

// SaveUploadedRom stores an uploaded game: as a new game, or over the game the user already has with its file name on
// that console. Only the fields given are set on a game that's there already, as Drizzle leaves out what's undefined.
// Uploaded again with other content, the game's old file id is returned too, to be removed with RemoveUnusedRomFiles
func SaveUploadedRom(ctx context.Context, scope Scope, platform, fileName string, fields []RomField) (Object, string, error) {
	now := db.Millis(time.Now())
	// Looked up and stored in one transaction, so the same file name uploaded twice at once is one game
	transaction, err := scope.Database.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", err
	}
	defer transaction.Rollback()
	var existing, previousFileID string
	err = transaction.QueryRowContext(ctx,
		`SELECT id, file_id FROM roms WHERE user_id = ? AND platform = ? AND status = ? AND file_name = ? LIMIT 1`,
		scope.User.ID, platform, db.StatusNormal, fileName).Scan(&existing, &previousFileID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, "", err
	}
	columns := make([]string, 0, len(fields)+4)
	arguments := make([]any, 0, len(fields)+4)
	for _, field := range fields {
		columns = append(columns, field.Column)
		arguments = append(arguments, field.Value)
	}
	if existing != "" {
		set := make([]string, len(columns))
		for i, column := range columns {
			set[i] = column + " = ?"
		}
		set = append(set, "updated_at = ?")
		arguments = append(arguments, now, existing)
		rom, err := scanObject(transaction.QueryRowContext(ctx,
			`UPDATE roms SET `+strings.Join(set, ", ")+` WHERE id = ? RETURNING `+selectColumns("", romColumns),
			arguments...), romColumns)
		if err != nil {
			return nil, "", err
		}
		if err := transaction.Commit(); err != nil {
			return nil, "", err
		}
		if fileID, _ := rom.Get("fileId").(string); fileID != previousFileID {
			return rom, previousFileID, nil
		}
		return rom, "", nil
	}
	columns = append(columns, "created_at", "id", "status", "updated_at")
	arguments = append(arguments, now, ids.New(), db.StatusNormal, now)
	rom, err := scanObject(transaction.QueryRowContext(ctx,
		`INSERT INTO roms (`+strings.Join(columns, ", ")+`) VALUES (`+placeholders(len(columns))+`) RETURNING `+
			selectColumns("", romColumns), arguments...), romColumns)
	if err != nil {
		return nil, "", err
	}
	return rom, "", transaction.Commit()
}

// MustJSON is a value as JSON, as JSON.stringify writes it
func MustJSON(value any) []byte {
	return mustJSON(value)
}
