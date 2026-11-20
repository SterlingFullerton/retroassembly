package library

import (
	"context"
	"math"
	"strings"

	"retroassembly/server/internal/db"
)

// A game on several discs is listed once: its discs share a group, and the lowest-numbered one stands for the game
const listedOnce = `(roms.disc_group IS NULL OR roms.id = (
	SELECT first.id FROM roms first
	WHERE first.user_id = roms.user_id AND first.platform = roms.platform
		AND first.disc_group = roms.disc_group AND first.status = 1
	ORDER BY first.disc_number, first.created_at LIMIT 1
))`

// How many discs a game has in the library: 1 for a game that isn't on several
const discCount = `CASE WHEN roms.disc_group IS NULL THEN 1 ELSE (
	SELECT count(*) FROM roms disc
	WHERE disc.user_id = roms.user_id AND disc.platform = roms.platform
		AND disc.disc_group = roms.disc_group AND disc.status = 1
) END`

// LaunchBox's community rating (out of 5), and how many people gave one
const (
	rating      = `coalesce(json_extract(roms.raw_game_metadata, '$.launchbox.communityRating'), 0)`
	ratingCount = `coalesce(json_extract(roms.raw_game_metadata, '$.launchbox.communityRatingCount'), 0)`
)

// placeholders is the inside of an IN list of n values. With none, it's NULL, which nothing is IN: the same as Drizzle's
// empty inArray, which matches nothing
func placeholders(n int) string {
	if n == 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

func strings2any(values []string) []any {
	result := make([]any, len(values))
	for i, v := range values {
		result[i] = v
	}
	return result
}

// listed is the games listed in the library: the owner's, on the consoles shown, each game on several discs once
func listed(scope Scope, platforms []string) (string, []any) {
	return `roms.user_id = ? AND roms.status = ? AND roms.platform IN (` + placeholders(len(platforms)) + `) AND ` + listedOnce,
		append([]any{scope.LibraryOwnerID, db.StatusNormal}, strings2any(platforms)...)
}

func favoriteJoin() string {
	return `LEFT JOIN favorites ON favorites.rom_id = roms.id AND favorites.user_id = ? AND favorites.status = 1`
}

// romsByIDs is whole rows for these games, in this order, as the game lists have them
func romsByIDs(ctx context.Context, scope Scope, gameIDs []string) ([]Object, error) {
	return romRows(ctx, scope, gameIDs, false)
}

// romRows is whole rows for these games, in this order. Whether each is a favorite is true or false, or as 1 or 0 where
// the Node server answers it as the database gives it (favoriteAsNumber)
func romRows(ctx context.Context, scope Scope, gameIDs []string, favoriteAsNumber bool) ([]Object, error) {
	if len(gameIDs) == 0 {
		return []Object{}, nil
	}
	arguments := append([]any{scope.User.ID}, strings2any(gameIDs)...)
	rows, err := queryObjects(ctx, scope.Database, func(rows *sqlRows) (Object, error) {
		var count int64
		var favorite bool
		object, err := scanObject(rows, romColumns, &count, &favorite)
		if err != nil {
			return nil, err
		}
		var isFavorite any = favorite
		if favoriteAsNumber {
			isFavorite = 0
			if favorite {
				isFavorite = 1
			}
		}
		return append(object, Field{"discCount", count}, Field{"isFavorite", isFavorite}), nil
	}, `SELECT `+selectColumns("roms", romColumns)+`, `+discCount+`, favorites.id IS NOT NULL
		FROM roms `+favoriteJoin()+` WHERE roms.id IN (`+placeholders(len(gameIDs))+`)`, arguments...)
	if err != nil {
		return nil, err
	}
	byID := map[string]Object{}
	for _, rom := range rows {
		byID[rom.Get("id").(string)] = rom
	}
	ordered := []Object{}
	for _, id := range gameIDs {
		if rom, ok := byID[id]; ok {
			ordered = append(ordered, rom)
		}
	}
	return ordered, nil
}

func pickedIDs(ctx context.Context, scope Scope, query string, arguments ...any) ([]Object, error) {
	rows, err := scope.Database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	var gameIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		gameIDs = append(gameIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return romsByIDs(ctx, scope, gameIDs)
}

const pickLimit = 12

// RediscoverPicks is well-rated games this player has never started, a different handful each time
func RediscoverPicks(ctx context.Context, scope Scope, platforms []string) ([]Object, error) {
	where, arguments := listed(scope, platforms)
	return pickedIDs(ctx, scope, `SELECT roms.id FROM roms WHERE `+where+`
		AND roms.id NOT IN (SELECT rom_id FROM launch_records WHERE user_id = ? AND status = ?)
		AND `+rating+` >= 3.5 AND `+ratingCount+` >= 10
		ORDER BY random() LIMIT ?`,
		append(arguments, scope.User.ID, db.StatusNormal, pickLimit)...)
}

// OnThisDayPicks is games first released on this day of the year (as MM-DD), the best known first
func OnThisDayPicks(ctx context.Context, scope Scope, platforms []string, monthDay string) ([]Object, error) {
	where, arguments := listed(scope, platforms)
	return pickedIDs(ctx, scope, `SELECT roms.id FROM roms WHERE `+where+`
		AND roms.game_release_date IS NOT NULL
		AND strftime('%m-%d', roms.game_release_date / 1000, 'unixepoch') = ?
		ORDER BY `+ratingCount+` DESC LIMIT ?`,
		append(arguments, monthDay, pickLimit)...)
}

// PlayTogetherPicks is well-known games for two or more players, a different handful each time
func PlayTogetherPicks(ctx context.Context, scope Scope, platforms []string) ([]Object, error) {
	where, arguments := listed(scope, platforms)
	return pickedIDs(ctx, scope, `SELECT roms.id FROM roms WHERE `+where+`
		AND roms.game_players >= 2 AND `+rating+` >= 3 AND `+ratingCount+` >= 20
		ORDER BY random() LIMIT ?`,
		append(arguments, pickLimit)...)
}

// The columns of a game the play history lists, after the play's own, in the Node server's order
var historyColumns = []column{
	{"core", plain, "launch_records.core"},
	{"count", plain, "count(launch_records.id)"},
	{"id", plain, "launch_records.rom_id"},
	{"lastLaunched", timestamp, "max(launch_records.created_at)"},
	{"platform", plain, "launch_records.platform"},
	{"discCount", plain, discCount},
	{"fileId", plain, "roms.file_id"},
	{"fileName", plain, "roms.file_name"},
	{"gameBoxartFileIds", plain, "roms.game_boxart_file_ids"},
	{"gameName", plain, "roms.game_name"},
	{"gameTitle", plain, "roms.game_title"},
	{"launchboxGameId", plain, "roms.launchbox_game_id"},
	{"libretroGameId", plain, "roms.libretro_game_id"},
	{"rawGameMetadata", jsonText, "roms.raw_game_metadata"},
}

// Pagination is which page of a list this is, as the API answers it. Numbers are as the page asked for them
type Pagination struct {
	Current float64 `json:"current"`
	Pages   float64 `json:"pages"`
	Size    float64 `json:"size"`
	Total   int64   `json:"total"`
}

// History is a page of the games the player has started, most recently played first
type History struct {
	Pagination Pagination `json:"pagination"`
	Roms       []Object   `json:"roms"`
}

// LaunchHistory is the play history list, on the consoles shown. A game deleted since is still listed. With a search,
// only the played games that match it, still most recently played first
func LaunchHistory(ctx context.Context, scope Scope, platforms []string, page, pageSize float64, search string) (*History, error) {
	where := `launch_records.user_id = ? AND launch_records.status = ? AND launch_records.platform IN (` +
		placeholders(len(platforms)) + `)`
	arguments := append([]any{scope.User.ID, db.StatusNormal}, strings2any(platforms)...)
	if search != "" {
		matches, _, err := FindSearchMatches(ctx, scope, SearchScope{Platforms: platforms}, search)
		if err != nil {
			return nil, err
		}
		if len(matches) == 0 {
			return &History{Pagination: Pagination{Current: page, Size: pageSize}, Roms: []Object{}}, nil
		}
		ids := make([]string, len(matches))
		for i, match := range matches {
			ids[i] = match.ID
		}
		where += ` AND launch_records.rom_id IN (` + placeholders(len(ids)) + `)`
		arguments = append(arguments, strings2any(ids)...)
	}
	columnsSQL := make([]string, len(historyColumns))
	for i, c := range historyColumns {
		columnsSQL[i] = c.sql
	}
	// The favorites join's user comes first, then the conditions', then the page
	queryArguments := append(append([]any{scope.User.ID}, arguments...), sqlNumber(pageSize), sqlNumber((page-1)*pageSize))
	roms, err := queryObjects(ctx, scope.Database, func(rows *sqlRows) (Object, error) {
		var favorite bool
		object, err := scanObject(rows, historyColumns, &favorite)
		if err != nil {
			return nil, err
		}
		return append(object, Field{"isFavorite", favorite}), nil
	}, `SELECT `+strings.Join(columnsSQL, ", ")+`, favorites.id IS NOT NULL
		FROM launch_records
		LEFT JOIN roms ON launch_records.rom_id = roms.id
		`+favoriteJoin()+`
		WHERE `+where+`
		GROUP BY launch_records.rom_id, roms.file_name, roms.launchbox_game_id, roms.libretro_game_id
		ORDER BY max(launch_records.created_at) DESC
		LIMIT ? OFFSET ?`, queryArguments...)
	if err != nil {
		return nil, err
	}
	var total int64
	err = scope.Database.QueryRowContext(ctx,
		`SELECT count(DISTINCT launch_records.rom_id) FROM launch_records WHERE `+where, arguments...).Scan(&total)
	if err != nil {
		return nil, err
	}
	return &History{
		Pagination: Pagination{Current: page, Pages: math.Ceil(float64(total) / pageSize), Size: pageSize, Total: total},
		Roms:       roms,
	}, nil
}

// FileGame is a game stored in a file, as RomsByFiles answers it
type FileGame struct {
	FileID    string  `json:"fileId"`
	FileName  string  `json:"fileName"`
	GameTitle *string `json:"gameTitle"`
	Platform  string  `json:"platform"`
}

// RomsByFiles is which games in the library are stored in the given files: for games kept on a device before their
// names were kept with them
func RomsByFiles(ctx context.Context, scope Scope, fileIDs []string) ([]FileGame, error) {
	games := []FileGame{}
	if len(fileIDs) == 0 {
		return games, nil
	}
	rows, err := scope.Database.QueryContext(ctx, `
		SELECT DISTINCT file_id, file_name, game_title, platform FROM roms
		WHERE user_id = ? AND status = ? AND file_id IN (`+placeholders(len(fileIDs))+`)`,
		append([]any{scope.LibraryOwnerID, db.StatusNormal}, strings2any(fileIDs)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var game FileGame
		if err := rows.Scan(&game.FileID, &game.FileName, &game.GameTitle, &game.Platform); err != nil {
			return nil, err
		}
		games = append(games, game)
	}
	return games, rows.Err()
}
