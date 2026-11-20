package gameinfo

import (
	"database/sql"
	"log"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/shared"
)

// Platforms are each console's names in libretro's database and in LaunchBox's
type Platforms = map[string]shared.GameInfoPlatform

// Database is the game info database, opened the first time it's needed. Without the file, games are added by their
// file names alone
type Database struct {
	Path      string
	Platforms Platforms

	once     sync.Once
	database *sql.DB
}

func (d *Database) open() *sql.DB {
	d.once.Do(func() {
		if _, err := os.Stat(d.Path); err != nil {
			log.Printf("No game info database at %s, so games are added without their info", d.Path)
			return
		}
		dsn := (&url.URL{Scheme: "file", Opaque: d.Path, RawQuery: "mode=ro&_pragma=query_only(1)"}).String()
		database, err := sql.Open("sqlite", dsn)
		if err != nil {
			log.Println(err)
			return
		}
		d.database = database
	})
	return d.database
}

// Available tells whether the game info database is there
func (d *Database) Available() bool {
	return d.open() != nil
}

// File is a file to look up: its name, and its MD5 when known
type File struct {
	MD5  *string
	Name string
}

// Result is a file's info from each database, nil for one that doesn't know it
type Result struct {
	Launchbox library.Object
	Libretro  library.Object
}

type columnKind int

const (
	plain columnKind = iota
	boolean
	timestamp
)

type column struct {
	key, name string
	kind      columnKind
}

// The tables' columns, in the order schema.ts lists them, which is the order a row's info is kept in
var (
	launchboxColumns = []column{
		{"communityRating", "community_rating", plain}, {"communityRatingCount", "community_rating_count", plain},
		{"compactName", "compact_name", plain}, {"cooperative", "cooperative", boolean},
		{"databaseId", "database_id", plain}, {"developer", "developer", plain}, {"dos", "dos", plain},
		{"esrb", "esrb", plain}, {"genres", "genres", plain},
		{"goodcodesBaseCompactName", "goodcodes_base_compact_name", plain}, {"maxPlayers", "max_players", plain},
		{"name", "name", plain}, {"overview", "overview", plain}, {"platform", "platform", plain},
		{"publisher", "publisher", plain}, {"releaseDate", "release_date", timestamp},
		{"releaseType", "release_type", plain}, {"releaseYear", "release_year", plain},
		{"setupFile", "setup_file", plain}, {"setupMd5", "setup_md5", plain}, {"startupFile", "startup_file", plain},
		{"startupMd5", "startup_md5", plain}, {"startupParameters", "startup_parameters", plain},
		{"steamAppId", "steam_app_id", plain}, {"videoUrl", "video_url", plain},
		{"wikipediaUrl", "wikipedia_url", plain},
	}
	libretroColumns = []column{
		{"compactName", "compact_name", plain}, {"crc", "crc", plain}, {"description", "description", plain},
		{"developer", "developer", plain}, {"esrbRating", "esrb_rating", plain}, {"franchise", "franchise", plain},
		{"genre", "genre", plain}, {"goodcodesBaseCompactName", "goodcodes_base_compact_name", plain},
		{"id", "id", plain}, {"md5", "md5", plain}, {"name", "name", plain}, {"origin", "origin", plain},
		{"platform", "platform", plain}, {"publisher", "publisher", plain},
		{"releasemonth", "releasemonth", plain}, {"releaseyear", "releaseyear", plain},
		{"romName", "rom_name", plain}, {"sha1", "sha1", plain}, {"size", "size", plain}, {"users", "users", plain},
	}
)

func selectFrom(table string, columns []column) string {
	names := make([]string, len(columns))
	for i, c := range columns {
		names[i] = `"` + c.name + `"`
	}
	return `select ` + strings.Join(names, ", ") + ` from "` + table + `"`
}

func number(value any) (float64, bool) {
	switch v := value.(type) {
	case int64:
		return float64(v), true
	case float64:
		return v, true
	}
	return 0, false
}

// value is a column's value as Drizzle reads it and JSON writes it: booleans as Number(value) === 1, timestamps as
// dates in JavaScript's way, text as text
func value(raw any, kind columnKind) any {
	if raw == nil {
		return nil
	}
	if bytes, ok := raw.([]byte); ok {
		raw = string(bytes)
	}
	switch kind {
	case boolean:
		n, ok := number(raw)
		if text, isText := raw.(string); isText {
			n, ok = jsNumber(text), true
		}
		return ok && n == 1
	case timestamp:
		n, ok := number(raw)
		if !ok || n != n || n > 8.64e15 || n < -8.64e15 {
			return nil
		}
		return time.UnixMilli(int64(n)).UTC().Format("2006-01-02T15:04:05.000Z")
	}
	return raw
}

// jsNumber is JavaScript's Number() of a text, NaN for one that isn't a number
func jsNumber(text string) float64 {
	trimmed := jsTrim(text)
	if trimmed == "" {
		return 0
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || strings.ContainsAny(trimmed, "_xXpP") {
		return math.NaN()
	}
	return n
}

func queryRows(database *sql.DB, columns []column, query string, arguments ...any) ([]library.Object, error) {
	rows, err := database.Query(query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var objects []library.Object
	for rows.Next() {
		raw := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range raw {
			pointers[i] = &raw[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		object := make(library.Object, len(columns))
		for i, c := range columns {
			object[i] = library.Field{Key: c.key, Value: value(raw[i], c.kind)}
		}
		objects = append(objects, object)
	}
	return objects, rows.Err()
}

func inList(column string, values []any) string {
	return `"` + column + `" in (` + strings.TrimSuffix(strings.Repeat("?, ", len(values)), ", ") + `)`
}

// or is Drizzle's or(): one condition as it is, several in brackets
func or(conditions []string) string {
	if len(conditions) == 1 {
		return conditions[0]
	}
	return "(" + strings.Join(conditions, " or ") + ")"
}

type filter struct {
	column string
	values []any
}

func conditions(table string, filters []filter) (string, []any) {
	var parts []string
	var arguments []any
	for _, f := range filters {
		parts = append(parts, inList(table+`"."`+f.column, f.values))
		arguments = append(arguments, f.values...)
	}
	return or(parts), arguments
}

func text(object library.Object, key string) (string, bool) {
	value, ok := object.Get(key).(string)
	return value, ok
}

type libretroFile struct {
	compactName, goodcodesBaseCompactName, name, romName string
	md5                                                  *string
}

func (f libretroFile) value(key string) (string, bool) {
	switch key {
	case "md5":
		if f.md5 == nil {
			return "", false
		}
		return *f.md5, true
	case "romName":
		return f.romName, true
	case "name":
		return f.name, true
	case "compactName":
		return f.compactName, true
	}
	return f.goodcodesBaseCompactName, true
}

var libretroNameColumns = []string{"md5", "romName", "name", "compactName", "goodcodesBaseCompactName"}

var columnNames = map[string]string{
	"md5": "md5", "romName": "rom_name", "name": "name", "compactName": "compact_name",
	"goodcodesBaseCompactName": "goodcodes_base_compact_name",
}

func (d *Database) identifyLibretroByColumns(database *sql.DB, keys []string, files []File, platform string) ([]library.Object, error) {
	extended := make([]libretroFile, len(files))
	for i, file := range files {
		name, _ := ParsePath(file.Name)
		extended[i] = libretroFile{
			compactName: CompactName(name), goodcodesBaseCompactName: GoodcodesBaseCompactName(name), md5: file.MD5,
			name: name, romName: file.Name,
		}
	}
	var filters []filter
	for _, key := range keys {
		var values []any
		for _, file := range extended {
			if value, ok := file.value(key); ok && value != "" {
				values = append(values, value)
			}
		}
		if len(values) > 0 {
			filters = append(filters, filter{columnNames[key], values})
		}
	}
	results := make([]library.Object, len(files))
	if len(filters) == 0 {
		return results, nil
	}
	where, arguments := conditions("libretro_games", filters)
	platforms := d.Platforms[platform].Libretro
	platformValues := make([]any, len(platforms))
	for i, name := range platforms {
		platformValues[i] = name
	}
	query := selectFrom("libretro_games", libretroColumns) + ` where (` + where + ` and ` +
		inList(`libretro_games"."platform`, platformValues) + `)`
	rows, err := queryRows(database, libretroColumns, query, append(arguments, platformValues...)...)
	if err != nil {
		return nil, err
	}
	for i, file := range extended {
		for _, key := range keys {
			wanted, ok := file.value(key)
			if !ok {
				continue
			}
			var candidates []library.Object
			for _, row := range rows {
				if value, isText := text(row, key); isText && value == wanted {
					candidates = append(candidates, row)
				}
			}
			if row := pickLibretroRow(candidates, file.romName); row != nil {
				results[i] = row
				break
			}
		}
	}
	return results, nil
}

var (
	unusualRelease = regexp.MustCompile(`(?i)\((?:Beta|Proto|Sample|Demo|Pirate|Aftermarket|Virtual Console|Evercade|Retro-Bit|Limited Run)\b|Collection\)`)
	revision       = regexp.MustCompile(`(?i)\((?:Rev\b|v1\.[1-9])`)
	fileRevision   = regexp.MustCompile(`(?i)\((?:PRG[` + jsSpace + `]*0*[1-9]|REV[` + jsSpace + `]*0*[1-9]|V1\.[1-9])`)
	discOfFile     = regexp.MustCompile(`(?i)\(Disc \d+\)`)
)

// pickLibretroRow is the best of several entries for the same game. libretro lists bad dumps, hacks and translations
// beside each release, and betas, prototypes and re-releases in collections. So, in turn: a plain release, one for the
// file's own region and disc, an ordinary one, the revision the file names or none, then libretro's own order
func pickLibretroRow(rows []library.Object, fileName string) library.Object {
	if len(rows) == 0 {
		return nil
	}
	if len(rows) == 1 {
		return rows[0]
	}
	baseName, _ := ParsePath(fileName)
	fileCountries := Countries(baseName)
	wantsRevision := fileRevision.MatchString(baseName)
	disc := strings.ToLower(discOfFile.FindString(baseName))
	rank := func(row library.Object) int {
		name, _ := text(row, "name")
		score := 0
		if strings.Contains(name, "[") {
			score += 8
		}
		if len(fileCountries) > 0 {
			found := false
			for _, each := range fileCountries {
				if strings.Contains(name, each) {
					found = true
				}
			}
			if !found {
				score += 4
			}
		}
		if disc != "" && !strings.Contains(jsLower(name), disc) {
			score += 4
		}
		if unusualRelease.MatchString(name) && !unusualRelease.MatchString(baseName) {
			score += 2
		}
		if revision.MatchString(name) != wantsRevision {
			score++
		}
		return score
	}
	best := rows[0]
	for _, row := range rows[1:] {
		if rank(row) < rank(best) {
			best = row
		}
	}
	return best
}

// identifyLibretro looks a file up by its MD5 first; then by its name, exactly, then with only letters and digits,
// then without its tags
func (d *Database) identifyLibretro(database *sql.DB, platform string, files []File) ([]library.Object, error) {
	byMD5, err := d.identifyLibretroByColumns(database, libretroNameColumns[:1], files, platform)
	if err != nil {
		return nil, err
	}
	all := true
	for _, row := range byMD5 {
		if row == nil {
			all = false
		}
	}
	if all {
		return byMD5, nil
	}
	keys := libretroNameColumns[1:]
	if platform == "arcade" {
		keys = []string{"romName"}
	}
	byName, err := d.identifyLibretroByColumns(database, keys, files, platform)
	if err != nil {
		return nil, err
	}
	for i := range byMD5 {
		if byMD5[i] == nil {
			byMD5[i] = byName[i]
		}
	}
	return byMD5, nil
}

// identifyLaunchbox looks a file up by name, with "Title, The" read as "The Title", and by the other names LaunchBox
// lists for its games
func (d *Database) identifyLaunchbox(database *sql.DB, platform string, files []File) ([]library.Object, error) {
	type launchboxFile struct {
		alternates                            []int64
		compactName, goodcodesBaseCompactName string
	}
	extended := make([]launchboxFile, len(files))
	compactNames := make([]any, len(files))
	for i, file := range files {
		name, _ := ParsePath(file.Name)
		restored := RestoreTitleForSorting(GoodcodesBase(name))
		extended[i] = launchboxFile{compactName: CompactName(restored), goodcodesBaseCompactName: GoodcodesBaseCompactName(restored)}
		compactNames[i] = extended[i].compactName
	}
	if len(files) == 0 {
		return nil, nil
	}
	alternateRows, err := database.Query(`select "alternate_name", "compact_name", "database_id", "id", "region" from "launchbox_game_alternate_names" where `+
		inList(`launchbox_game_alternate_names"."compact_name`, compactNames), compactNames...)
	if err != nil {
		return nil, err
	}
	for alternateRows.Next() {
		var (
			alternateName, compactName, region sql.NullString
			databaseID, id                     sql.NullInt64
		)
		if err := alternateRows.Scan(&alternateName, &compactName, &databaseID, &id, &region); err != nil {
			alternateRows.Close()
			return nil, err
		}
		for i := range extended {
			if compactName.Valid && compactName.String == extended[i].compactName && databaseID.Valid && databaseID.Int64 != 0 {
				extended[i].alternates = append(extended[i].alternates, databaseID.Int64)
			}
		}
	}
	alternateRows.Close()
	if err := alternateRows.Err(); err != nil {
		return nil, err
	}

	var filters []filter
	for _, key := range []string{"compactName", "goodcodesBaseCompactName"} {
		var values []any
		for _, file := range extended {
			value := file.compactName
			if key == "goodcodesBaseCompactName" {
				value = file.goodcodesBaseCompactName
			}
			if value != "" {
				values = append(values, value)
			}
		}
		if len(values) > 0 {
			filters = append(filters, filter{columnNames[key], values})
		}
	}
	var ids []any
	for _, file := range extended {
		for _, id := range file.alternates {
			ids = append(ids, id)
		}
	}
	if len(ids) > 0 {
		filters = append(filters, filter{"database_id", ids})
	}
	results := make([]library.Object, len(files))
	if len(filters) == 0 {
		return results, nil
	}
	where, arguments := conditions("launchbox_games", filters)
	query := selectFrom("launchbox_games", launchboxColumns) + ` where (` + where + ` and "launchbox_games"."platform" = ?)`
	rows, err := queryRows(database, launchboxColumns, query, append(arguments, d.Platforms[platform].Launchbox)...)
	if err != nil {
		return nil, err
	}
	for i, file := range extended {
	columns:
		for _, key := range []string{"compactName", "goodcodesBaseCompactName"} {
			wanted := file.compactName
			if key == "goodcodesBaseCompactName" {
				wanted = file.goodcodesBaseCompactName
			}
			for _, row := range rows {
				if value, ok := text(row, key); ok && value == wanted {
					results[i] = row
					break columns
				}
			}
			for _, row := range rows {
				id, _ := number(row.Get("databaseId"))
				for _, alternate := range file.alternates {
					if id == float64(alternate) {
						results[i] = row
						break columns
					}
				}
			}
		}
	}
	return results, nil
}

// Identify is each file's info from libretro's database and LaunchBox's, or nil without the game info database.
// LaunchBox's is looked up by libretro's name for the game when libretro knows it, since that name is the cleanest
func (d *Database) Identify(files []File, platform string) ([]Result, error) {
	database := d.open()
	if database == nil {
		return nil, nil
	}
	results := make([]Result, len(files))
	if _, known := d.Platforms[platform]; !known {
		return results, nil
	}
	libretro, err := d.identifyLibretro(database, platform, files)
	if err != nil {
		return nil, err
	}
	named := make([]File, len(files))
	for i, file := range files {
		named[i] = file
		if libretro[i] != nil {
			_, extension := ParsePath(file.Name)
			name, ok := text(libretro[i], "name")
			if !ok {
				name = "null"
			}
			named[i].Name = name + extension
		}
	}
	launchbox, err := d.identifyLaunchbox(database, platform, named)
	if err != nil {
		return nil, err
	}
	for i := range files {
		results[i] = Result{Launchbox: launchbox[i], Libretro: libretro[i]}
	}
	return results, nil
}

// LaunchboxAgain is LaunchBox's info (with the description) for a game libretro knows but LaunchBox didn't match:
// libretro's name, then the file's, each without the tags that stop the match
func (d *Database) LaunchboxAgain(fileName, libretroName, platform string) library.Object {
	name, extension := ParsePath(fileName)
	seen := map[string]bool{}
	for _, candidate := range []string{libretroName, name} {
		if candidate == "" {
			continue
		}
		candidate = NameForLaunchbox(candidate) + extension
		if seen[candidate] || candidate == extension {
			seen[candidate] = true
			continue
		}
		seen[candidate] = true
		results, err := d.Identify([]File{{Name: candidate}}, platform)
		if err != nil {
			log.Println(err)
			continue
		}
		if len(results) > 0 && results[0].Launchbox != nil {
			return results[0].Launchbox
		}
	}
	return nil
}

// Condition is a game matched before, by its LaunchBox and libretro IDs
type Condition struct {
	LaunchboxID *int64
	LibretroID  *string
}

// Query is the info stored for games matched before, by their IDs, or nil without the game info database. A side
// that isn't found is left out
func (d *Database) Query(conditions []Condition) ([]library.Object, error) {
	database := d.open()
	if database == nil {
		return nil, nil
	}
	var launchboxIDs, libretroIDs []any
	for _, condition := range conditions {
		if condition.LaunchboxID != nil && *condition.LaunchboxID != 0 {
			launchboxIDs = append(launchboxIDs, *condition.LaunchboxID)
		}
		if condition.LibretroID != nil && *condition.LibretroID != "" {
			libretroIDs = append(libretroIDs, *condition.LibretroID)
		}
	}
	var launchboxRows, libretroRows []library.Object
	var err error
	if len(launchboxIDs) > 0 {
		launchboxRows, err = queryRows(database, launchboxColumns, selectFrom("launchbox_games", launchboxColumns)+
			` where `+inList(`launchbox_games"."database_id`, launchboxIDs), launchboxIDs...)
		if err != nil {
			return nil, err
		}
	}
	if len(libretroIDs) > 0 {
		libretroRows, err = queryRows(database, libretroColumns, selectFrom("libretro_games", libretroColumns)+
			` where `+inList(`libretro_games"."id`, libretroIDs), libretroIDs...)
		if err != nil {
			return nil, err
		}
	}
	results := make([]library.Object, len(conditions))
	for i, condition := range conditions {
		result := library.Object{}
		if condition.LaunchboxID != nil {
			for _, row := range launchboxRows {
				if id, _ := number(row.Get("databaseId")); id == float64(*condition.LaunchboxID) {
					result = append(result, library.Field{Key: "launchbox", Value: row})
					break
				}
			}
		}
		if condition.LibretroID != nil {
			for _, row := range libretroRows {
				if id, _ := text(row, "id"); id == *condition.LibretroID {
					result = append(result, library.Field{Key: "libretro", Value: row})
					break
				}
			}
		}
		results[i] = result
	}
	return results, nil
}

// DefaultPath is where the game info database is: GAME_INFO_DB, or game-info/game-info.sqlite
// in the folder the server is started in
func DefaultPath() string {
	if path := config.Get("GAME_INFO_DB"); path != "" {
		absolute, err := filepath.Abs(path)
		if err == nil {
			return absolute
		}
		return path
	}
	absolute, _ := filepath.Abs(filepath.Join("game-info", "game-info.sqlite"))
	return absolute
}
