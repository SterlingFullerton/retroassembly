package library

import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// A game on several discs is uploaded as one file per disc, named the No-Intro way: "Chrono Cross (USA) (Disc 1).chd".
// The name before "(Disc N)" is the game; anything after it, such as "(Evolution Disc)", only describes that disc
var discPattern = regexp.MustCompile(`(?i)^(.+?) \((?:Disc|Disk|CD) (\d+)(?: of \d+)?\)`)

// jsTrim is JavaScript's String.prototype.trim
func jsTrim(value string) string {
	return strings.TrimFunc(value, func(r rune) bool {
		return r == 0xfeff || r != 0x85 && unicode.IsSpace(r)
	})
}

// ParseDisc is the game and disc number in a disc's file name, as parseDisc reads them, or false for a file that
// isn't one of several discs
func ParseDisc(fileName string) (group string, number float64, ok bool) {
	match := discPattern.FindStringSubmatch(fileName)
	if match == nil {
		return "", 0, false
	}
	number, err := strconv.ParseFloat(match[2], 64)
	if err != nil {
		number = math.Inf(1)
	}
	return jsTrim(match[1]), number, true
}

// DiscFields are a game's disc group and number, for a console whose games come on several discs; nil for others
func DiscFields(multiDisc map[string]bool, platform, fileName string) (group, number any) {
	if !multiDisc[platform] {
		return nil, nil
	}
	discGroup, discNumber, ok := ParseDisc(fileName)
	if !ok {
		return nil, nil
	}
	return discGroup, sqlNumber(discNumber)
}

// UpdateDiscGroups groups discs uploaded before grouping existed, and keeps each game's saves, favorites and history
// together, as src/utils/server/disc-groups.ts does at startup
func UpdateDiscGroups(ctx context.Context, database *sql.DB, consoles []string) error {
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	if err := assignDiscGroups(ctx, transaction, consoles); err != nil {
		return err
	}
	if err := mergeDiscGroups(ctx, transaction, nil); err != nil {
		return err
	}
	return transaction.Commit()
}

// DiscGroup names one game on several discs in one player's library
type DiscGroup struct {
	UserID, Platform string
	Group            any
}

// MergeDiscGroup keeps one game's saves, favorites and history together after a disc of it is added, without going
// through the rest of the library as UpdateDiscGroups does
func MergeDiscGroup(ctx context.Context, database *sql.DB, group DiscGroup) error {
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	if err := mergeDiscGroups(ctx, transaction, &group); err != nil {
		return err
	}
	return transaction.Commit()
}

// assignDiscGroups gives the games uploaded before discs were grouped their disc group and number
func assignDiscGroups(ctx context.Context, transaction *sql.Tx, consoles []string) error {
	if len(consoles) == 0 {
		return nil
	}
	multiDisc := map[string]bool{}
	for _, console := range consoles {
		multiDisc[console] = true
	}
	rows, err := transaction.QueryContext(ctx, `SELECT id, platform, file_name FROM roms
		WHERE disc_group IS NULL AND platform IN (`+placeholders(len(consoles))+`)`, strings2any(consoles)...)
	if err != nil {
		return err
	}
	type update struct {
		id            string
		group, number any
	}
	var updates []update
	for rows.Next() {
		var id, platform string
		var fileName sql.NullString
		if err := rows.Scan(&id, &platform, &fileName); err != nil {
			rows.Close()
			return err
		}
		if group, number := DiscFields(multiDisc, platform, fileName.String); group != nil && group != "" {
			updates = append(updates, update{id, group, number})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, each := range updates {
		if _, err := transaction.ExecContext(ctx, `UPDATE roms SET disc_group = ?, disc_number = ? WHERE id = ?`,
			each.group, each.number, each.id); err != nil {
			return err
		}
	}
	return nil
}

// mergeDiscGroups moves each player's saves, favorites and play history from a game's other discs to the disc that
// stands for it (the lowest-numbered one in the library), so the game has them all in one place. Saves keep which disc
// they were made on. With only, just that game's discs are gone through. Only discs that have something to move are
// read: at each start that's almost none, as the rest were merged before
func mergeDiscGroups(ctx context.Context, transaction *sql.Tx, only *DiscGroup) error {
	filter, arguments := "", []any{}
	if only != nil {
		filter = ` AND roms.user_id = ? AND roms.platform = ? AND roms.disc_group = ?`
		arguments = []any{only.UserID, only.Platform, only.Group}
	}
	rows, err := transaction.QueryContext(ctx, `
		SELECT discs.id, discs.disc_number, discs.representative FROM (
			SELECT roms.id, roms.disc_number, (
				SELECT first.id FROM roms first
				WHERE first.user_id = roms.user_id AND first.platform = roms.platform AND first.disc_group = roms.disc_group
					AND first.status = 1
				ORDER BY first.disc_number, first.created_at LIMIT 1
			) AS representative
			FROM roms
			WHERE roms.disc_group IS NOT NULL AND roms.status = 1`+filter+`
		) discs
		WHERE discs.representative != discs.id AND (
			EXISTS (SELECT 1 FROM states WHERE states.rom_id = discs.id)
			OR EXISTS (SELECT 1 FROM launch_records WHERE launch_records.rom_id = discs.id)
			OR EXISTS (SELECT 1 FROM game_saves WHERE game_saves.rom_id = discs.id)
			OR EXISTS (SELECT 1 FROM favorites WHERE favorites.rom_id = discs.id)
		)`, arguments...)
	if err != nil {
		return err
	}
	type other struct {
		id             string
		discNumber     any
		representative sql.NullString
	}
	var others []other
	for rows.Next() {
		var each other
		if err := rows.Scan(&each.id, &each.discNumber, &each.representative); err != nil {
			rows.Close()
			return err
		}
		others = append(others, each)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, each := range others {
		representative := each.representative.String
		if representative == "" || representative == each.id {
			continue
		}
		for _, statement := range []struct {
			query     string
			arguments []any
		}{
			{`UPDATE states SET disc = coalesce(disc, ?), rom_id = ? WHERE rom_id = ?`, []any{each.discNumber, representative, each.id}},
			{`UPDATE launch_records SET rom_id = ? WHERE rom_id = ?`, []any{representative, each.id}},
			{`UPDATE game_saves SET rom_id = ? WHERE rom_id = ?`, []any{representative, each.id}},
			// A player has at most one favorite per game: one on another disc is dropped if the game already has one
			{`DELETE FROM favorites WHERE rom_id = ? AND user_id IN (SELECT user_id FROM favorites WHERE rom_id = ?)`,
				[]any{each.id, representative}},
			{`UPDATE favorites SET rom_id = ? WHERE rom_id = ?`, []any{representative, each.id}},
		} {
			if _, err := transaction.ExecContext(ctx, statement.query, statement.arguments...); err != nil {
				return err
			}
		}
	}
	return nil
}
