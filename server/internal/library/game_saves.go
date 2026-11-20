package library

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/ids"
)

// How many versions of a game's save are kept, newest first, so a bad save can be undone
const keptGameSaveVersions = 10

// GameSave is a version of a game's own save (a memory card, a cartridge's battery save), as the API answers it, in the
// order of the Node server's columns
type GameSave struct {
	ClientID  *string     `json:"clientId"`
	Core      string      `json:"core"`
	Platform  string      `json:"platform"`
	RomID     string      `json:"romId"`
	Sha1      string      `json:"sha1"`
	Size      int64       `json:"size"`
	CreatedAt auth.JSTime `json:"createdAt"`
	ID        string      `json:"id"`
	Status    int         `json:"status"`
	UpdatedAt auth.JSTime `json:"updatedAt"`
	FileID    string      `json:"fileId"`
	UserID    string      `json:"userId"`
}

const gameSaveColumns = `client_id, core, platform, rom_id, sha1, size, created_at, id, status, updated_at, file_id,
	user_id`

// Two versions can share a millisecond: the one stored last is the newer
const newestGameSavesFirst = `ORDER BY created_at DESC, rowid DESC`

var errGameSaveNotFound = failure.New(http.StatusNotFound, "Game save not found")

func scanGameSave(scanner interface{ Scan(...any) error }) (*GameSave, error) {
	var (
		save                 GameSave
		clientID             sql.NullString
		createdAt, updatedAt int64
	)
	err := scanner.Scan(&clientID, &save.Core, &save.Platform, &save.RomID, &save.Sha1, &save.Size, &createdAt,
		&save.ID, &save.Status, &updatedAt, &save.FileID, &save.UserID)
	if err != nil {
		return nil, err
	}
	if clientID.Valid {
		save.ClientID = &clientID.String
	}
	save.CreatedAt, save.UpdatedAt = auth.JSTime(db.Time(createdAt)), auth.JSTime(db.Time(updatedAt))
	return &save, nil
}

func noneFound(save *GameSave, err error) (*GameSave, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return save, err
}

// LatestGameSave is the latest version of a game's save with an emulator, to put back before the game starts
func LatestGameSave(ctx context.Context, scope Scope, core, rom string) (*GameSave, error) {
	return noneFound(scanGameSave(scope.Database.QueryRowContext(ctx,
		`SELECT `+gameSaveColumns+` FROM game_saves WHERE user_id = ? AND status = ? AND rom_id = ? AND core = ? `+
			newestGameSavesFirst+` LIMIT 1`,
		scope.User.ID, db.StatusNormal, rom, core)))
}

// ListGameSaves is a game's kept versions with an emulator, newest first
func ListGameSaves(ctx context.Context, scope Scope, core, rom string) ([]*GameSave, error) {
	rows, err := scope.Database.QueryContext(ctx,
		`SELECT `+gameSaveColumns+` FROM game_saves WHERE user_id = ? AND status = ? AND rom_id = ? AND core = ? `+
			newestGameSavesFirst+` LIMIT ?`,
		scope.User.ID, db.StatusNormal, rom, core, keptGameSaveVersions)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	saves := []*GameSave{}
	for rows.Next() {
		save, err := scanGameSave(rows)
		if err != nil {
			return nil, err
		}
		saves = append(saves, save)
	}
	return saves, rows.Err()
}

// NewGameSave is a version of a game's save being uploaded
type NewGameSave struct {
	ClientID *string
	// The save, read twice (for its checksum, then to store it) rather than held in memory
	Content io.ReadSeeker
	Core    string
	// The file's extension, as the emulator names it: srm, or dsv for DeSmuME
	FileType *string
	Rom      string
}

var fileTypePattern = regexp.MustCompile(`^[a-z\d]{1,8}$`)

func findGameSaveByClientID(ctx context.Context, scope Scope, clientID string) (*GameSave, error) {
	return noneFound(scanGameSave(scope.Database.QueryRowContext(ctx,
		`SELECT `+gameSaveColumns+` FROM game_saves WHERE user_id = ? AND client_id = ? LIMIT 1`,
		scope.User.ID, clientID)))
}

// CreateGameSave keeps a new version of a game's save. A save the same as the latest isn't kept again, nor one already
// stored under the browser's id; past the newest few, older versions are let go
func CreateGameSave(ctx context.Context, scope Scope, input NewGameSave) (*GameSave, error) {
	rom, err := FindRom(ctx, scope, input.Rom)
	if err != nil {
		return nil, err
	}
	if input.ClientID != nil {
		sent, err := findGameSaveByClientID(ctx, scope, *input.ClientID)
		if err != nil || sent != nil {
			return sent, err
		}
	}

	hash := sha1.New()
	size, err := io.Copy(hash, input.Content)
	if err != nil {
		return nil, err
	}
	if _, err := input.Content.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	latest, err := LatestGameSave(ctx, scope, input.Core, rom.ID)
	if err != nil {
		return nil, err
	}
	if latest != nil && latest.Sha1 == digest {
		return latest, nil
	}

	id := ids.New()
	extension := "srm"
	if input.FileType != nil && fileTypePattern.MatchString(*input.FileType) {
		extension = *input.FileType
	}
	fileID := path.Join("game-saves", scope.User.ID, rom.Platform, rom.ID, id+"."+extension)
	if err := scope.Storage.Put(fileID, input.Content); err != nil {
		return nil, err
	}
	now := db.Millis(time.Now())
	saved, err := scanGameSave(scope.Database.QueryRowContext(ctx, `
		INSERT INTO game_saves (client_id, core, file_id, id, platform, rom_id, sha1, size, user_id, created_at, status,
			updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `+gameSaveColumns,
		input.ClientID, input.Core, fileID, id, rom.Platform, rom.ID, digest, size, scope.User.ID, now,
		db.StatusNormal, now))
	if err != nil {
		// The same upload arrived twice at once, and the other copy was kept first
		scope.Storage.Delete(fileID)
		var sent *GameSave
		if input.ClientID != nil {
			sent, _ = findGameSaveByClientID(ctx, scope, *input.ClientID)
		}
		if sent == nil {
			return nil, err
		}
		return sent, nil
	}

	rows, err := scope.Database.QueryContext(ctx,
		`SELECT id, file_id FROM game_saves WHERE user_id = ? AND status = ? AND rom_id = ? AND core = ? `+
			newestGameSavesFirst+` LIMIT 1000 OFFSET ?`,
		scope.User.ID, db.StatusNormal, rom.ID, input.Core, keptGameSaveVersions)
	if err != nil {
		return nil, err
	}
	type version struct{ id, fileID string }
	var older []version
	for rows.Next() {
		var v version
		if err := rows.Scan(&v.id, &v.fileID); err != nil {
			rows.Close()
			return nil, err
		}
		older = append(older, v)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	for _, v := range older {
		if _, err := scope.Database.ExecContext(ctx, `UPDATE game_saves SET status = ?, updated_at = ? WHERE id = ?`,
			db.StatusDeleted, db.Millis(time.Now()), v.id); err != nil {
			return nil, err
		}
		scope.Storage.Delete(v.fileID)
	}
	return saved, nil
}

// RestoreGameSave makes an older version the one in use: it's copied to the top, so the version that was in use stays
// in the list. Restoring the version already in use changes nothing
func RestoreGameSave(ctx context.Context, scope Scope, id string) (*GameSave, error) {
	version, err := noneFound(scanGameSave(scope.Database.QueryRowContext(ctx,
		`SELECT `+gameSaveColumns+` FROM game_saves WHERE user_id = ? AND status = ? AND id = ? LIMIT 1`,
		scope.User.ID, db.StatusNormal, id)))
	if err != nil {
		return nil, err
	}
	if version == nil {
		return nil, errGameSaveNotFound
	}
	filePath, ok := scope.Storage.Path(version.FileID)
	if !ok {
		return nil, errGameSaveNotFound
	}
	content, err := os.Open(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errGameSaveNotFound
	}
	if err != nil {
		return nil, err
	}
	defer content.Close()
	fileType := strings.TrimPrefix(path.Ext(version.FileID), ".")
	return CreateGameSave(ctx, scope, NewGameSave{
		Content: content, Core: version.Core, FileType: &fileType, Rom: version.RomID,
	})
}
