package library

import (
	"context"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
)

// AssertCanWrite refuses accounts that share someone else's library, which they may only read
func AssertCanWrite(scope Scope) error {
	if scope.SharesLibrary() {
		return failure.New(http.StatusForbidden, scope.T("error.sharedLibraryReadOnly", nil))
	}
	return nil
}

// The fields of a game the player can change, by the names the API has them under
var editableColumns = map[string]string{
	"gameBoxartFileIds":    "game_boxart_file_ids",
	"gameDescription":      "game_description",
	"gameDeveloper":        "game_developer",
	"gameGenres":           "game_genres",
	"gameName":             "game_name",
	"gamePlayers":          "game_players",
	"gamePublisher":        "game_publisher",
	"gameReleaseDate":      "game_release_date",
	"gameReleaseYear":      "game_release_year",
	"gameThumbnailFileIds": "game_thumbnail_file_ids",
	"gameTitle":            "game_title",
}

// UpdateRom changes fields of a game in the user's own library (nil clears one), and is the game as it is now
func UpdateRom(ctx context.Context, scope Scope, id string, fields map[string]any) (Object, error) {
	if err := AssertCanWrite(scope); err != nil {
		return nil, err
	}
	if _, err := FindRom(ctx, scope, id); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		if _, ok := editableColumns[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	set := []string{"updated_at = ?"}
	arguments := []any{db.Millis(time.Now())}
	for _, key := range keys {
		value := fields[key]
		if date, ok := value.(time.Time); ok {
			value = db.Millis(date)
		}
		set = append(set, editableColumns[key]+" = ?")
		arguments = append(arguments, value)
	}
	arguments = append(arguments, id, scope.User.ID)
	return scanObject(scope.Database.QueryRowContext(ctx,
		`UPDATE roms SET `+strings.Join(set, ", ")+` WHERE id = ? AND user_id = ? RETURNING `+selectColumns("", romColumns),
		arguments...), romColumns)
}

// RomFiles is the images a game has: its box art, and its screenshots, comma separated
func RomFiles(ctx context.Context, scope Scope, id string) (boxart, thumbnails *string, err error) {
	err = scope.Database.QueryRowContext(ctx,
		`SELECT game_boxart_file_ids, game_thumbnail_file_ids FROM roms WHERE id = ?`, id).Scan(&boxart, &thumbnails)
	return boxart, thumbnails, err
}

// DeleteRoms deletes games from the user's own library, and their play history. A game's file goes once no game uses
// it any more
func DeleteRoms(ctx context.Context, scope Scope, ids []string) error {
	if err := AssertCanWrite(scope); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	now := db.Millis(time.Now())
	arguments := append([]any{db.StatusDeleted, now}, strings2any(ids)...)
	arguments = append(arguments, scope.User.ID)
	rows, err := scope.Database.QueryContext(ctx,
		`UPDATE roms SET status = ?, updated_at = ? WHERE id IN (`+placeholders(len(ids))+`) AND user_id = ?
		RETURNING file_id, id, platform`,
		arguments...)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	var fileIDs, pictureFolders []string
	for rows.Next() {
		var fileID, id, platform string
		if err := rows.Scan(&fileID, &id, &platform); err != nil {
			rows.Close()
			return err
		}
		if !seen[fileID] {
			seen[fileID] = true
			fileIDs = append(fileIDs, fileID)
		}
		pictureFolders = append(pictureFolders, PicturesFolder(scope.User.ID, platform, id))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := scope.Database.ExecContext(ctx,
		`UPDATE launch_records SET status = ?, updated_at = ? WHERE rom_id IN (`+placeholders(len(ids))+`) AND user_id = ?`,
		arguments...); err != nil {
		return err
	}
	// The box art and screenshots added to a deleted game are kept for it alone
	for _, folder := range pictureFolders {
		scope.Storage.DeleteFolder(folder)
	}
	return removeUnusedRomFiles(ctx, scope, fileIDs)
}

// PicturesFolder is where the box art and screenshots a user adds to a game are kept
func PicturesFolder(userID, platform, romID string) string {
	return path.Join("attachments", userID, platform, romID)
}

// removeUnusedRomFiles removes the game files no game uses any more. One file is shared by every game with the same
// content, whoever added it
func removeUnusedRomFiles(ctx context.Context, scope Scope, fileIDs []string) error {
	if len(fileIDs) == 0 {
		return nil
	}
	referenced := map[string]bool{}
	stillUsed, err := scope.Database.QueryContext(ctx,
		`SELECT file_id FROM roms WHERE file_id IN (`+placeholders(len(fileIDs))+`) AND status = ?`,
		append(strings2any(fileIDs), db.StatusNormal)...)
	if err != nil {
		return err
	}
	for stillUsed.Next() {
		var fileID string
		if err := stillUsed.Scan(&fileID); err != nil {
			stillUsed.Close()
			return err
		}
		referenced[fileID] = true
	}
	stillUsed.Close()
	for _, fileID := range fileIDs {
		if !referenced[fileID] {
			scope.Storage.Delete(fileID)
		}
	}
	return stillUsed.Err()
}

// DeleteRom deletes a game in the library
func DeleteRom(ctx context.Context, scope Scope, id string) error {
	if _, err := FindRom(ctx, scope, id); err != nil {
		return err
	}
	return DeleteRoms(ctx, scope, []string{id})
}
