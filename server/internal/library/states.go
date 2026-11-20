package library

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/ids"
)

// State is a save state (a snapshot of a game while it runs) and its thumbnail, as the API answers it, in the order of
// the Node server's columns
type State struct {
	ClientID        *string     `json:"clientId"`
	Core            string      `json:"core"`
	Disc            *int64      `json:"disc"`
	Platform        string      `json:"platform"`
	RomID           string      `json:"romId"`
	ThumbnailFileID string      `json:"thumbnailFileId"`
	Type            string      `json:"type"`
	CreatedAt       auth.JSTime `json:"createdAt"`
	ID              string      `json:"id"`
	Status          int         `json:"status"`
	UpdatedAt       auth.JSTime `json:"updatedAt"`
	FileID          string      `json:"fileId"`
	UserID          string      `json:"userId"`
}

const stateColumns = `client_id, core, disc, platform, rom_id, thumbnail_file_id, type, created_at, id, status,
	updated_at, file_id, user_id`

func scanState(scanner interface{ Scan(...any) error }) (*State, error) {
	var (
		state                State
		clientID             sql.NullString
		disc                 sql.NullInt64
		createdAt, updatedAt int64
	)
	err := scanner.Scan(&clientID, &state.Core, &disc, &state.Platform, &state.RomID, &state.ThumbnailFileID,
		&state.Type, &createdAt, &state.ID, &state.Status, &updatedAt, &state.FileID, &state.UserID)
	if err != nil {
		return nil, err
	}
	if clientID.Valid {
		state.ClientID = &clientID.String
	}
	if disc.Valid {
		state.Disc = &disc.Int64
	}
	state.CreatedAt, state.UpdatedAt = auth.JSTime(db.Time(createdAt)), auth.JSTime(db.Time(updatedAt))
	return &state, nil
}

func scanStates(rows *sql.Rows, err error) ([]*State, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := []*State{}
	for rows.Next() {
		state, err := scanState(rows)
		if err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

// StatesQuery picks the user's saves for a game: of a type ("manual", "auto", or "any" for both), with an emulator,
// and how many at the most (none for all)
type StatesQuery struct {
	Core  string
	Limit int
	Rom   string
	Type  string
}

// GetStates is the user's own saves for a game in their library, newest first
func GetStates(ctx context.Context, scope Scope, query StatesQuery) ([]*State, error) {
	if _, err := FindRom(ctx, scope, query.Rom); err != nil {
		return nil, err
	}
	where := []string{"user_id = ?", "status = ?", "rom_id = ?"}
	arguments := []any{scope.User.ID, db.StatusNormal, query.Rom}
	if query.Type == "auto" || query.Type == "manual" {
		where, arguments = append(where, "type = ?"), append(arguments, query.Type)
	}
	if query.Core != "" {
		where, arguments = append(where, "core = ?"), append(arguments, query.Core)
	}
	sql := `SELECT ` + stateColumns + ` FROM states WHERE ` + strings.Join(where, " AND ") + ` ORDER BY created_at DESC`
	if query.Limit > 0 {
		sql += ` LIMIT ?`
		arguments = append(arguments, query.Limit)
	}
	return scanStates(scope.Database.QueryContext(ctx, sql, arguments...))
}

// NewState is a save state being uploaded
type NewState struct {
	// The browser's id for this save; a save already stored under it isn't stored again
	ClientID  *string
	Core      string
	Disc      *int64
	Rom       string
	State     []byte
	Thumbnail []byte
	Type      string
}

func findStateByClientID(ctx context.Context, scope Scope, clientID string) (*State, error) {
	state, err := scanState(scope.Database.QueryRowContext(ctx,
		`SELECT `+stateColumns+` FROM states WHERE user_id = ? AND client_id = ? LIMIT 1`, scope.User.ID, clientID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return state, err
}

// CreateState stores a save state. Past the newest few automatic saves of a game, older ones are let go
func CreateState(ctx context.Context, scope Scope, input NewState) (*State, error) {
	rom, err := FindRom(ctx, scope, input.Rom)
	if err != nil {
		return nil, err
	}
	// The same save sent again, for example after the connection dropped before the answer arrived
	if input.ClientID != nil {
		existing, err := findStateByClientID(ctx, scope, *input.ClientID)
		if err != nil || existing != nil {
			return existing, err
		}
	}

	id := ids.New()
	folder := path.Join("states", scope.User.ID, rom.Platform, input.Rom)
	stateFileID, thumbnailFileID := path.Join(folder, id+".state"), path.Join(folder, id+".png")
	if err := scope.Storage.Put(stateFileID, bytes.NewReader(input.State)); err != nil {
		return nil, err
	}
	if err := scope.Storage.Put(thumbnailFileID, bytes.NewReader(input.Thumbnail)); err != nil {
		return nil, err
	}
	now := db.Millis(time.Now())
	state, err := scanState(scope.Database.QueryRowContext(ctx, `
		INSERT INTO states (client_id, core, disc, file_id, platform, rom_id, thumbnail_file_id, type, user_id,
			created_at, id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `+stateColumns,
		input.ClientID, input.Core, input.Disc, stateFileID, rom.Platform, rom.ID, thumbnailFileID, input.Type,
		scope.User.ID, now, ids.New(), db.StatusNormal, now))
	if err != nil {
		// The same save arrived twice at once and the other copy was stored first: keep that one
		var stored *State
		if input.ClientID != nil {
			stored, _ = findStateByClientID(ctx, scope, *input.ClientID)
		}
		if stored == nil {
			return nil, err
		}
		scope.Storage.Delete(stateFileID)
		scope.Storage.Delete(thumbnailFileID)
		return stored, nil
	}

	if input.Type == "auto" {
		autoStates, err := scanStates(scope.Database.QueryContext(ctx,
			`SELECT `+stateColumns+` FROM states WHERE user_id = ? AND rom_id = ? AND status = ? AND type = 'auto'
			ORDER BY created_at DESC`, scope.User.ID, rom.ID, db.StatusNormal))
		if err != nil {
			return nil, err
		}
		if len(autoStates) > scope.MaxAutoStates {
			var older []string
			for _, old := range autoStates[scope.MaxAutoStates:] {
				older = append(older, old.ID)
			}
			if _, err := DeleteStates(ctx, scope, older); err != nil {
				return nil, err
			}
		}
	}
	return state, nil
}

// DeleteStates deletes the user's own saves among ids, and their files; anyone else's are left alone. It's how many
// were deleted
func DeleteStates(ctx context.Context, scope Scope, stateIDs []string) (int, error) {
	if len(stateIDs) == 0 {
		return 0, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(stateIDs)), ", ")
	arguments := []any{db.StatusDeleted, db.Millis(time.Now()), scope.User.ID, db.StatusNormal}
	for _, id := range stateIDs {
		arguments = append(arguments, id)
	}
	rows, err := scope.Database.QueryContext(ctx, `
		UPDATE states SET status = ?, updated_at = ? WHERE user_id = ? AND status = ? AND id IN (`+placeholders+`)
		RETURNING file_id, thumbnail_file_id`, arguments...)
	if err != nil {
		return 0, err
	}
	var fileIDs []string
	for rows.Next() {
		var fileID, thumbnailFileID string
		if err := rows.Scan(&fileID, &thumbnailFileID); err != nil {
			rows.Close()
			return 0, err
		}
		fileIDs = append(fileIDs, fileID, thumbnailFileID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, fileID := range fileIDs {
		scope.Storage.Delete(fileID)
	}
	return len(fileIDs) / 2, nil
}

// DeleteState deletes one of the user's saves; anyone else's is treated as not there
func DeleteState(ctx context.Context, scope Scope, id string) error {
	deleted, err := DeleteStates(ctx, scope, []string{id})
	if err != nil {
		return err
	}
	if deleted == 0 {
		return failure.New(http.StatusNotFound, "State not found")
	}
	return nil
}
