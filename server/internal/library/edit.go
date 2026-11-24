package library

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/files"
)

// AssertCanWrite refuses players, who may only play: adding games and editing them is for contributors and admins
func AssertCanWrite(scope Scope) error {
	if !scope.User.CanAddGames() {
		return failure.New(http.StatusForbidden, scope.T("error.sharedLibraryReadOnly", nil))
	}
	return nil
}

// AssertCanDelete refuses anyone but an admin: a deleted game is gone for everyone
func AssertCanDelete(scope Scope) error {
	if !scope.User.IsAdmin() {
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

// UpdateRom changes fields of a game in the library (nil clears one), and is the game as it is now
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
	arguments = append(arguments, id, scope.LibraryOwnerID)
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

// DeleteRoms deletes games from the library, and everyone's play history of them. A game's file goes once no game
// uses it any more. Only for admins
func DeleteRoms(ctx context.Context, scope Scope, ids []string) error {
	if err := AssertCanDelete(scope); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	now := db.Millis(time.Now())
	arguments := append([]any{db.StatusDeleted, now}, strings2any(ids)...)
	rows, err := scope.Database.QueryContext(ctx,
		`UPDATE roms SET status = ?, updated_at = ? WHERE id IN (`+placeholders(len(ids))+`) AND user_id = ?
		RETURNING file_id, id, platform, game_boxart_file_ids, game_thumbnail_file_ids`,
		append(arguments, scope.LibraryOwnerID)...)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	var fileIDs, pictureFolders []string
	for rows.Next() {
		var (
			fileID, id, platform string
			boxart, thumbnails   sql.NullString
		)
		if err := rows.Scan(&fileID, &id, &platform, &boxart, &thumbnails); err != nil {
			rows.Close()
			return err
		}
		if !seen[fileID] {
			seen[fileID] = true
			fileIDs = append(fileIDs, fileID)
		}
		pictureFolders = append(pictureFolders, PicturesFolder(scope.LibraryOwnerID, platform, id))
		// A game that came from a library of someone's own, before there was one for all, has its pictures in theirs
		for _, picture := range strings.Split(boxart.String+","+thumbnails.String, ",") {
			if IsPictureOf(picture, platform, id) {
				pictureFolders = append(pictureFolders, path.Dir(picture))
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := scope.Database.ExecContext(ctx,
		`UPDATE launch_records SET status = ?, updated_at = ? WHERE rom_id IN (`+placeholders(len(ids))+`)`,
		arguments...); err != nil {
		return err
	}
	// The box art and screenshots added to a deleted game are kept for it alone
	for _, folder := range pictureFolders {
		scope.Storage.DeleteFolder(folder)
	}
	return RemoveUnusedRomFiles(ctx, scope, fileIDs)
}

// IsPictureOf tells whether a stored file is a picture added to that game: in its folder, under whichever account
// the library was kept, and nowhere it climbs out to with ".."
func IsPictureOf(fileID, platform, romID string) bool {
	parts := strings.Split(fileID, "/")
	return path.Clean(fileID) == fileID && len(parts) == 5 && parts[0] == "attachments" && parts[1] != "" &&
		parts[2] == platform && parts[3] == romID
}

// PicturesFolder is where the box art and screenshots added to a game are kept, under the library's account
func PicturesFolder(userID, platform, romID string) string {
	return path.Join("attachments", userID, platform, romID)
}

// RemoveUnusedRomFiles removes the game files no game uses any more. One file is shared by every game with the same
// content, whoever added it, so each is checked and removed under its lock, where an upload of it waits
func RemoveUnusedRomFiles(ctx context.Context, scope Scope, fileIDs []string) error {
	for _, fileID := range fileIDs {
		if fileID == "" {
			continue
		}
		unlock := files.Lock(fileID)
		var used string
		err := scope.Database.QueryRowContext(ctx, `SELECT id FROM roms WHERE file_id = ? AND status = ? LIMIT 1`,
			fileID, db.StatusNormal).Scan(&used)
		if errors.Is(err, sql.ErrNoRows) {
			scope.Storage.Delete(fileID)
			err = nil
		}
		unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

// DeleteRom deletes a game in the library
func DeleteRom(ctx context.Context, scope Scope, id string) error {
	if _, err := FindRom(ctx, scope, id); err != nil {
		return err
	}
	return DeleteRoms(ctx, scope, []string{id})
}
