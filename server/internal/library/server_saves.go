package library

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"strconv"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/ids"
)

// Saves collected from games on the server. A game there keeps its save every few seconds, so each would push the
// player's older versions out within minutes: instead, a game's versions are kept one for each few minutes it runs, the
// newest of each, and the save it started from stays among the older ones. Each is stored under a browser id of its
// own, made from the game's id, which tells the game's versions apart from others

// How long a game on the server runs for each version of its save that's kept
const serverSaveWindow = 5 * time.Minute

// The browser id of a version kept from a game on the server begins with this and the game's id
const serverSavePrefix = "server:"

func serverSaveSession(game string) string {
	return serverSavePrefix + game + ":"
}

// IsRomNotFound is whether err is a game missing from the library: one deleted since, whose saves can't be kept
func IsRomNotFound(err error) bool {
	return errors.Is(err, errRomNotFound)
}

// KeptFromServer is whether the game on the server with this id has had a save with this checksum kept already, as
// any version of the game's save with the emulator, even one let go since
func KeptFromServer(ctx context.Context, scope Scope, core, rom, game, sum string) (bool, error) {
	session := serverSaveSession(game)
	var found int
	err := scope.Database.QueryRowContext(ctx, `SELECT 1 FROM game_saves WHERE user_id = ? AND rom_id = ? AND core = ?
		AND sha1 = ? AND substr(client_id, 1, ?) = ? LIMIT 1`,
		scope.User.ID, rom, core, sum, len(session), session).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// KeepServerGameSave keeps a save collected from the game on the server with this id, which started then, as the
// newest version of the player's save. A version the game made earlier in the same few minutes is replaced by it
func KeepServerGameSave(ctx context.Context, scope Scope, input NewGameSave, game string, started time.Time) (*GameSave,
	error) {
	window := serverSaveSession(game) + strconv.FormatInt(int64(time.Since(started)/serverSaveWindow), 10) + ":"
	clientID := window + ids.New()
	input.ClientID = &clientID
	rom, err := FindRom(ctx, scope, input.Rom)
	if err != nil {
		return nil, err
	}
	previous, err := LatestGameSave(ctx, scope, input.Core, rom.ID)
	if err != nil {
		return nil, err
	}
	saved, err := CreateGameSave(ctx, scope, input)
	if err != nil {
		return nil, err
	}
	replaced := previous != nil && previous.ClientID != nil && saved.ID != previous.ID &&
		len(*previous.ClientID) > len(window) && (*previous.ClientID)[:len(window)] == window
	if replaced {
		if _, err := scope.Database.ExecContext(ctx, `UPDATE game_saves SET status = ?, updated_at = ? WHERE id = ?`,
			db.StatusDeleted, db.Millis(time.Now()), previous.ID); err != nil {
			return nil, err
		}
		scope.Storage.Delete(previous.FileID)
	}
	return saved, nil
}

// DeSmuME keeps a DS game's save as a .dsv: the game's own save, as melonDS keeps it in a .sav, padded, then a footer
// that says how long the save is, ending with a mark of its own
var (
	desmumeSaveMark   = []byte("|-DESMUME SAVE-|")
	desmumeFooterText = []byte("|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:")
)

// The footer's numbers, before its mark: the save's length, its padded length, its kind, its address size, its memory
// size and the footer's version
const desmumeFooterNumbers = 6 * 4

// desmumeSaveLength is how long the save in a .dsv is, and whether it's one
func desmumeSaveLength(dsv []byte) (int, bool) {
	end := len(dsv) - len(desmumeSaveMark)
	numbers := end - desmumeFooterNumbers
	text := numbers - len(desmumeFooterText)
	if text < 0 || !bytes.Equal(dsv[end:], desmumeSaveMark) || !bytes.Equal(dsv[text:numbers], desmumeFooterText) {
		return 0, false
	}
	length := int(binary.LittleEndian.Uint32(dsv[numbers:]))
	if length <= 0 || length > text {
		return 0, false
	}
	return length, true
}

// SaveFromDSV is the plain save in a DeSmuME .dsv, as melonDS keeps it, and whether it is one
func SaveFromDSV(dsv []byte) ([]byte, bool) {
	length, ok := desmumeSaveLength(dsv)
	if !ok {
		return nil, false
	}
	return dsv[:length], true
}

// DSVFromSave is a plain save made into a .dsv like `like`, a DeSmuME save of the same game, and whether it could be:
// only a save of the same length as the one in `like` is
func DSVFromSave(save, like []byte) ([]byte, bool) {
	length, ok := desmumeSaveLength(like)
	if !ok || length != len(save) {
		return nil, false
	}
	return append(append([]byte{}, save...), like[length:]...), true
}
