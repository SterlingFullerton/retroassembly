package library

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"

	"retroassembly/server/internal/db"
)

// The orders a game list can be sorted in, as src/constants/roms-order.ts has them
var romsOrders = []string{"added", "name", "played", "popular", "released"}

// Best match: only while searching, where it's the order a search starts in
const searchOrder = "match"

// DefaultDirection is how an order reads by default: Popular and Most played from the top, the rest from A or the
// oldest. Best match is always best first
func DefaultDirection(order string) string {
	if order == "popular" || order == "played" {
		return "desc"
	}
	return "asc"
}

// ListOrder is a list's order from the address: best match while searching unless another is picked, and never without
// a search. Popular otherwise
func ListOrder(sort string, searching bool) string {
	if searching && (sort == "" || sort == searchOrder) {
		return searchOrder
	}
	for _, order := range romsOrders {
		if order == sort {
			return order
		}
	}
	return "popular"
}

// ListQuery is what a game list shows: its order and direction, favorites only or not, a page, a search
type ListQuery struct {
	Direction string
	Favorite  bool
	ID        string
	OrderBy   string
	Page      float64
	PageSize  float64
	Platform  string
	Search    string
	// Without counting the whole list, for a row that shows only its first games
	WithoutTotal bool
}

// SearchInfo is the search a list shows the matches of, and how many games it looked through
type SearchInfo struct {
	Query    string `json:"query"`
	Searched int    `json:"searched"`
}

// RomList is a page of a game list
type RomList struct {
	// Every match's id, for the letters; not sent to the page
	MatchIDs   []string
	Pagination Pagination
	Roms       []Object
	Search     *SearchInfo
}

// The indexes idx_roms_popular and idx_roms_name (and their _platform pair) hold this expression and the name's, in
// the order a list sorted most popular first, or by name, reads them: a page is read from one, not sorted from every
// game. They are used only for these exact expressions, so a change here is a change to them (migration 0014)
//
// Popular: the game's LaunchBox rating, weighted by how many people rated it, so a 4.9 from 3 votes doesn't beat a 4.4
// from 600. It's the rating, pulled towards an average (3.5) as if by 100 more votes; games nobody rated sort last
const popularity = `CASE WHEN json_extract(roms.raw_game_metadata, '$.launchbox.communityRatingCount') > 0 THEN
	(json_extract(roms.raw_game_metadata, '$.launchbox.communityRatingCount') *
		json_extract(roms.raw_game_metadata, '$.launchbox.communityRating') + 350.0) /
	(json_extract(roms.raw_game_metadata, '$.launchbox.communityRatingCount') + 100) END`

var orderColumns = map[string]string{
	"added":    "roms.created_at",
	"name":     "LOWER(roms.file_name)",
	"played":   "plays.play_count",
	"popular":  popularity,
	"released": "roms.game_release_date",
}

// GetRoms is a page of the games in the library, as getRoms gives it: on the consoles shown (or one), each game on
// several discs once (unless one game is asked for by id), with how many discs each has and whether it's a favorite
func GetRoms(ctx context.Context, scope Scope, platforms []string, query ListQuery) (*RomList, error) {
	if query.PageSize == 0 {
		query.PageSize = 100
	}
	if query.Page == 0 {
		query.Page = 1
	}
	if query.Direction == "" {
		query.Direction = "asc"
	}
	if query.OrderBy == "" {
		query.OrderBy = "name"
	}
	where := []string{"roms.user_id = ?", "roms.status = ?"}
	arguments := []any{scope.LibraryOwnerID, db.StatusNormal}
	if query.ID != "" {
		where, arguments = append(where, "roms.id = ?"), append(arguments, query.ID)
	} else {
		where = append(where, listedOnce)
	}
	if query.Platform != "" {
		where, arguments = append(where, "roms.platform = ?"), append(arguments, query.Platform)
	} else {
		where = append(where, "roms.platform IN ("+placeholders(len(platforms))+")")
		arguments = append(arguments, strings2any(platforms)...)
	}
	offset := (query.Page - 1) * query.PageSize

	// A search: the matching games, best match first. Sorted by best match, the page is cut from them here; sorted any
	// other way, the database sorts the matches
	var matchIDs []string
	var search *SearchInfo
	if query.Search != "" {
		matches, searched, err := FindSearchMatches(ctx, scope,
			SearchScope{Favorite: query.Favorite, Platform: query.Platform, Platforms: platforms}, query.Search)
		if err != nil {
			return nil, err
		}
		matchIDs = []string{}
		for _, match := range matches {
			matchIDs = append(matchIDs, match.ID)
		}
		search = &SearchInfo{Query: query.Search, Searched: searched}
	}
	orderBy := query.OrderBy
	if orderBy == searchOrder && matchIDs == nil {
		orderBy = "name"
	}
	var pageIDs []string
	if orderBy == searchOrder && matchIDs != nil {
		start := min(len(matchIDs), max(0, int(offset)))
		end := min(len(matchIDs), start+int(query.PageSize))
		pageIDs = append([]string{}, matchIDs[start:end]...)
		where = append(where, "roms.id IN ("+placeholders(len(pageIDs))+")")
		arguments = append(arguments, strings2any(pageIDs)...)
	} else if matchIDs != nil {
		where = append(where, "roms.id IN (SELECT value FROM json_each(?))")
		arguments = append(arguments, string(mustJSON(matchIDs)))
	}
	// Favorites only: the list starts from the favorites, a few hundred at most, rather than from every game
	favorites := favoriteJoin()
	if query.Favorite {
		favorites = strings.TrimPrefix(favorites, "LEFT ")
	}
	condition := strings.Join(where, " AND ")

	column := orderColumns["name"]
	if orderBy != searchOrder {
		column = orderColumns[orderBy]
	}
	direction := ""
	if query.Direction == "desc" {
		direction = " DESC"
	}
	// Games without the value last. Sorted newest or highest first they are anyway, and a game always has its file name
	// and the date it was added: there, the sort is left to follow the column's index, so a page of the newest games
	// reads only those
	order := []string{"(" + column + ")" + direction}
	if direction == "" && orderBy != "added" && orderBy != "name" {
		order = append([]string{"(" + column + ") IS NULL"}, order...)
	}
	if orderBy == "played" {
		order = append(order, "plays.last_played"+direction)
	}
	if orderBy != "name" {
		order = append(order, orderColumns["name"])
	}
	// Games of the same name (one game on two consoles, or uploaded twice) in the same order every time, so a page break
	// between them never shows one twice and the other not at all. Not when sorted by when they were added: two games
	// added in the same millisecond with the same name don't happen, and a third term would keep the newest from being
	// read in the order of their index
	if orderBy != "added" {
		order = append(order, "roms.id")
	}

	// Favorites only: the list starts from the few favorites, so they are sorted, rather than every game read in the
	// order of a sort's index to find them. A unary + keeps the sort off the index and changes nothing else
	if query.Favorite {
		order[0] = "+" + order[0]
	}

	// Most played: how many times this player has launched the game, then how recently. Counted only for that order
	plays := ""
	queryArguments := []any{scope.User.ID}
	if orderBy == "played" {
		plays = `LEFT JOIN (SELECT count(*) AS play_count, max(created_at) AS last_played, rom_id FROM launch_records
		WHERE user_id = ? AND status = ? GROUP BY rom_id) plays ON plays.rom_id = roms.id`
		queryArguments = append(queryArguments, scope.User.ID, db.StatusNormal)
	}
	queryArguments = append(queryArguments, arguments...)
	sqlText := `SELECT ` + selectColumns("roms", romColumns) + `, ` + discCount + `, favorites.id IS NOT NULL
		FROM roms ` + favorites + ` ` + plays + ` WHERE ` + condition
	if pageIDs == nil {
		sqlText += ` ORDER BY ` + strings.Join(order, ", ") + ` LIMIT ? OFFSET ?`
		queryArguments = append(queryArguments, sqlNumber(query.PageSize), sqlNumber(offset))
	}
	roms, err := queryObjects(ctx, scope.Database, func(rows *sqlRows) (Object, error) {
		var count int64
		var favorite bool
		object, err := scanObject(rows, romColumns, &count, &favorite)
		if err != nil {
			return nil, err
		}
		isFavorite := 0
		if favorite {
			isFavorite = 1
		}
		return append(object, Field{"discCount", count}, Field{"isFavorite", isFavorite}), nil
	}, sqlText, queryArguments...)
	if err != nil {
		return nil, err
	}
	if pageIDs != nil {
		position := map[string]int{}
		for i, id := range pageIDs {
			position[id] = i
		}
		ordered := make([]Object, 0, len(roms))
		for _, id := range pageIDs {
			for _, rom := range roms {
				if rom.Get("id") == id {
					ordered = append(ordered, rom)
				}
			}
		}
		roms = ordered
	}

	total := int64(len(matchIDs))
	if matchIDs == nil && !query.WithoutTotal {
		err := scope.Database.QueryRowContext(ctx,
			`SELECT count(*) FROM roms `+favorites+` WHERE `+condition,
			append([]any{scope.User.ID}, arguments...)...).Scan(&total)
		if err != nil {
			return nil, err
		}
	}
	return &RomList{
		MatchIDs: matchIDs,
		Pagination: Pagination{
			Current: query.Page, Pages: math.Ceil(float64(total) / query.PageSize), Size: query.PageSize, Total: total,
		},
		Roms:   roms,
		Search: search,
	}, nil
}

// GetRom is a game in the library by its id, on the consoles shown; nil when there's none
func GetRom(ctx context.Context, scope Scope, platforms []string, id string) (Object, error) {
	list, err := GetRoms(ctx, scope, platforms, ListQuery{ID: id})
	if err != nil || len(list.Roms) == 0 {
		return nil, err
	}
	return list.Roms[0], nil
}

// FindRomByFile is the id of a game in the library by its file name and console; empty when there's none
func FindRomByFile(ctx context.Context, scope Scope, platform, fileName string) (string, error) {
	var id string
	// The index is named: left to choose, SQLite walks every game of the console in a wider one
	err := scope.Database.QueryRowContext(ctx, `SELECT id FROM roms INDEXED BY idx_roms_user_platform_filename
		WHERE file_name = ? AND platform = ? AND user_id = ? AND status = ? ORDER BY file_name LIMIT 1`,
		fileName, platform, scope.LibraryOwnerID, db.StatusNormal).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// LetterPage is where a letter's games start in a list sorted by name
type LetterPage struct {
	// Whether any game starts with it
	Has    bool   `json:"has"`
	Letter string `json:"letter"`
	// The page its first game is on
	Page float64 `json:"page"`
}

// LettersQuery is which games a list's letters count
type LettersQuery struct {
	Direction string
	Favorite  bool
	// Only these games: a search's matches
	IDs      []string
	Platform string
}

// Letters is, for a list sorted by name, which page each letter's games start on, and which letters have games. "#" is
// the games starting with anything other than a letter. Names are compared as the database compares them: lowercase
// ASCII, byte by byte
func Letters(ctx context.Context, scope Scope, platforms []string, query LettersQuery) ([]LetterPage, error) {
	if query.Direction == "" {
		query.Direction = "asc"
	}
	where := []string{"roms.user_id = ?", "roms.status = ?", listedOnce}
	arguments := []any{scope.LibraryOwnerID, db.StatusNormal}
	if query.Platform != "" {
		where, arguments = append(where, "roms.platform = ?"), append(arguments, query.Platform)
	} else {
		where = append(where, "roms.platform IN ("+placeholders(len(platforms))+")")
		arguments = append(arguments, strings2any(platforms)...)
	}
	if query.Favorite {
		where = append(where, "favorites.id IS NOT NULL")
	}
	if query.IDs != nil {
		where = append(where, "roms.id IN (SELECT value FROM json_each(?))")
		arguments = append(arguments, string(mustJSON(query.IDs)))
	}
	rows, err := scope.Database.QueryContext(ctx, `SELECT LOWER(roms.file_name) FROM roms `+favoriteJoin()+` WHERE `+
		strings.Join(where, " AND "), append([]any{scope.User.ID}, arguments...)...)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	const pageSize = 100
	pageOf := func(position int) float64 { return math.Floor(float64(position)/pageSize) + 1 }
	lettered := 0
	letters := make([]LetterPage, 0, 27)
	for letter := 'a'; letter <= 'z'; letter++ {
		current, next := string(letter), string(letter+1)
		before, after, in := 0, 0, 0
		for _, name := range names {
			switch {
			case name < current:
				before++
			case name >= next:
				after++
			default:
				in++
			}
		}
		lettered += in
		position := before
		if query.Direction != "asc" {
			position = after
		}
		letters = append(letters, LetterPage{Has: in > 0, Letter: current, Page: pageOf(position)})
	}
	// Games starting with a number or symbol come first by name, and last the other way round
	symbols := LetterPage{Has: len(names)-lettered > 0, Letter: "#", Page: 1}
	if query.Direction != "asc" {
		symbols.Page = pageOf(lettered)
	}
	return append([]LetterPage{symbols}, letters...), nil
}

// PlatformCount is how many of the consoles shown have games
func PlatformCount(ctx context.Context, scope Scope, platforms []string) (int64, error) {
	var count int64
	err := scope.Database.QueryRowContext(ctx, `SELECT COUNT(DISTINCT platform) FROM roms
		WHERE user_id = ? AND status = ? AND platform IN (`+placeholders(len(platforms))+`)`,
		append([]any{scope.LibraryOwnerID, db.StatusNormal}, strings2any(platforms)...)...).Scan(&count)
	return count, err
}

// ConsoleCount is how many games a console has
type ConsoleCount struct {
	Count    int64  `json:"count"`
	Platform string `json:"platform"`
}

// Overview is how many games each console shown has, most first
func Overview(ctx context.Context, scope Scope, platforms []string) ([]ConsoleCount, error) {
	where, arguments := listed(scope, platforms)
	rows, err := scope.Database.QueryContext(ctx,
		`SELECT count(*), roms.platform FROM roms WHERE `+where+` GROUP BY roms.platform ORDER BY count(*) DESC`,
		arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	consoles := []ConsoleCount{}
	for rows.Next() {
		var console ConsoleCount
		if err := rows.Scan(&console.Count, &console.Platform); err != nil {
			return nil, err
		}
		consoles = append(consoles, console)
	}
	return consoles, rows.Err()
}

// Disc is one of the discs of a game on several
type Disc struct {
	FileID   string `json:"fileId"`
	FileName string `json:"fileName"`
	ID       string `json:"id"`
	Number   int64  `json:"number"`
}

// Discs is the discs of a game on several discs, in order; empty for a game on one. Two copies of the same disc number
// count once
func Discs(ctx context.Context, scope Scope, platform string, discGroup any) ([]Disc, error) {
	group, ok := discGroup.(string)
	discs := []Disc{}
	if !ok || group == "" {
		return discs, nil
	}
	rows, err := scope.Database.QueryContext(ctx, `SELECT file_id, file_name, id, disc_number FROM roms
		WHERE user_id = ? AND status = ? AND platform = ? AND disc_group = ? ORDER BY disc_number ASC, created_at ASC`,
		scope.LibraryOwnerID, db.StatusNormal, platform, group)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := map[int64]bool{}
	for rows.Next() {
		var disc Disc
		var number sql.NullInt64
		if err := rows.Scan(&disc.FileID, &disc.FileName, &disc.ID, &number); err != nil {
			return nil, err
		}
		if !number.Valid || seen[number.Int64] {
			continue
		}
		seen[number.Int64] = true
		disc.Number = number.Int64
		discs = append(discs, disc)
	}
	return discs, rows.Err()
}

// The columns of a game with saves, in getRomsWithStates' order, before whether it's a favorite
var withStatesColumns = []column{
	{"createdAt", timestamp, "roms.created_at"},
	{"discCount", plain, discCount},
	{"fileId", plain, "roms.file_id"},
	{"fileName", plain, "roms.file_name"},
	{"gameBoxartFileIds", plain, "roms.game_boxart_file_ids"},
	{"gameName", plain, "roms.game_name"},
	{"gameTitle", plain, "roms.game_title"},
	{"id", plain, "roms.id"},
	{"lastSaved", timestamp, "saved.last_saved"},
	{"launchboxGameId", plain, "roms.launchbox_game_id"},
	{"libretroGameId", plain, "roms.libretro_game_id"},
	{"platform", plain, "roms.platform"},
	{"rawGameMetadata", jsonText, "roms.raw_game_metadata"},
}

// RomsWithStates is the games the player has saved states of, most recently saved first. It starts from the saves, so
// it reads the games saved, not the whole library
func RomsWithStates(ctx context.Context, scope Scope, platforms []string, pageSize int) ([]Object, error) {
	where, arguments := listed(scope, platforms)
	columnsSQL := make([]string, len(withStatesColumns))
	for i, c := range withStatesColumns {
		columnsSQL[i] = c.sql
	}
	return queryObjects(ctx, scope.Database, func(rows *sqlRows) (Object, error) {
		var favorite bool
		object, err := scanObject(rows, withStatesColumns, &favorite)
		if err != nil {
			return nil, err
		}
		return append(object, Field{"isFavorite", favorite}), nil
	}, `SELECT `+strings.Join(columnsSQL, ", ")+`, favorites.id IS NOT NULL
		FROM (SELECT rom_id, max(created_at) AS last_saved FROM states WHERE user_id = ? AND status = 1 GROUP BY rom_id) saved
		JOIN roms ON roms.id = saved.rom_id
		`+favoriteJoin()+`
		WHERE `+where+`
		ORDER BY saved.last_saved DESC
		LIMIT ? OFFSET 0`,
		append(append([]any{scope.User.ID, scope.User.ID}, arguments...), pageSize)...)
}
