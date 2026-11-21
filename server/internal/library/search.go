package library

import (
	"context"
	"database/sql"
	"math"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/search"
)

// SearchScope narrows a search: to a console (all the consoles shown for none), and to favorites
type SearchScope struct {
	Favorite  bool
	Platform  string
	Platforms []string
}

func nullString(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func number(value any) float64 {
	switch v := value.(type) {
	case int64:
		return float64(v)
	case float64:
		return v
	}
	return 0
}

// FindSearchMatches is every game in the list that matches a search, best match first, and how many games were
// searched. The quick search and a game list's search box both use it, so they find the same games in the same order
func FindSearchMatches(ctx context.Context, scope Scope, narrow SearchScope, query string) ([]*search.Candidate, int, error) {
	where := `roms.user_id = ? AND roms.status = ? AND ` + listedOnce
	arguments := []any{scope.User.ID, scope.LibraryOwnerID, db.StatusNormal}
	if narrow.Platform != "" {
		where += ` AND roms.platform = ?`
		arguments = append(arguments, narrow.Platform)
	} else {
		where += ` AND roms.platform IN (` + placeholders(len(narrow.Platforms)) + `)`
		arguments = append(arguments, strings2any(narrow.Platforms)...)
	}
	if narrow.Favorite {
		where += ` AND favorites.id IS NOT NULL`
	}
	// Only what matching needs is read for every game. How many people rated each, read from its LaunchBox data, is read
	// for the matches alone, to sort them
	rows, err := scope.Database.QueryContext(ctx, `
		SELECT roms.file_name, roms.game_developer, roms.game_name, roms.game_publisher, roms.game_title, roms.id,
			favorites.id IS NOT NULL, roms.platform
		FROM roms `+favoriteJoin()+` WHERE `+where, arguments...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var candidates []*search.Candidate
	for rows.Next() {
		var (
			candidate                                 search.Candidate
			developer, gameName, publisher, gameTitle sql.NullString
		)
		if err := rows.Scan(&candidate.FileName, &developer, &gameName, &publisher, &gameTitle, &candidate.ID,
			&candidate.IsFavorite, &candidate.Platform); err != nil {
			return nil, 0, err
		}
		candidate.GameDeveloper, candidate.GameName = nullString(developer), nullString(gameName)
		candidate.GamePublisher, candidate.GameTitle = nullString(publisher), nullString(gameTitle)
		candidate.Title = search.ShownTitle(candidate.GameTitle, candidate.Platform, candidate.GameName, candidate.FileName)
		candidates = append(candidates, &candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	rows.Close()
	matches := search.Match(candidates, search.NormalizeQuery(query))
	if err := readPopularity(ctx, scope, matches); err != nil {
		return nil, 0, err
	}
	search.Sort(matches)
	return matches, len(candidates), nil
}

// readPopularity reads how many people rated each match on LaunchBox
func readPopularity(ctx context.Context, scope Scope, matches []*search.Candidate) error {
	if len(matches) == 0 {
		return nil
	}
	byID := make(map[string]*search.Candidate, len(matches))
	ids := make([]string, len(matches))
	for i, match := range matches {
		byID[match.ID], ids[i] = match, match.ID
	}
	rows, err := scope.Database.QueryContext(ctx, `SELECT roms.id, `+ratingCount+` FROM roms
		WHERE roms.id IN (SELECT value FROM json_each(?))`, string(mustJSON(ids)))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id         string
			popularity any
		)
		if err := rows.Scan(&id, &popularity); err != nil {
			return err
		}
		if match := byID[id]; match != nil {
			match.Popularity = number(popularity)
		}
	}
	return rows.Err()
}

// SearchPage is a page of the games matching a search, as the quick search shows them
type SearchPage struct {
	Pagination Pagination
	// Left out of the answer when the search wasn't narrowed to a console
	Platform     *string
	Query        string
	Roms         []Object
	TrimmedQuery string
}

func (p SearchPage) MarshalJSON() ([]byte, error) {
	object := Object{{"pagination", p.Pagination}}
	if p.Platform != nil {
		object = append(object, Field{"platform", *p.Platform})
	}
	object = append(object, Field{"query", p.Query}, Field{"roms", p.Roms}, Field{"trimmedQuery", p.TrimmedQuery})
	return object.MarshalJSON()
}

// SearchRoms is a page of the games matching a search, best match first
func SearchRoms(ctx context.Context, scope Scope, platforms []string, platform *string, query string, page, pageSize float64) (*SearchPage, error) {
	narrow := SearchScope{Platforms: platforms}
	if platform != nil {
		narrow.Platform = *platform
	}
	ranked, _, err := FindSearchMatches(ctx, scope, narrow, query)
	if err != nil {
		return nil, err
	}
	// Whole rows only for the page returned
	offset := int(math.Max(0, (page-1)*pageSize))
	end := min(len(ranked), offset+int(math.Max(0, pageSize)))
	var pageIDs []string
	for i := offset; i < end; i++ {
		pageIDs = append(pageIDs, ranked[i].ID)
	}
	roms, err := romRows(ctx, scope, pageIDs, true)
	if err != nil {
		return nil, err
	}
	return &SearchPage{
		Pagination: Pagination{
			Current: page, Pages: math.Ceil(float64(len(ranked)) / pageSize), Size: pageSize, Total: int64(len(ranked)),
		},
		Platform:     platform,
		Query:        query,
		Roms:         roms,
		TrimmedQuery: search.NormalizeQuery(query),
	}, nil
}

// SearchCounts is how many games match a search, in all and on each console, and how many of them are favorites or
// have been played, for the counts beside each link in the sidebar
type SearchCounts struct {
	Favorites int    `json:"favorites"`
	Games     int    `json:"games"`
	History   int64  `json:"history"`
	Platforms Object `json:"platforms"`
}

// CountSearchMatches counts the same matches the lists show, from the same search
func CountSearchMatches(ctx context.Context, scope Scope, platforms []string, query string) (*SearchCounts, error) {
	matches, _, err := FindSearchMatches(ctx, scope, SearchScope{Platforms: platforms}, query)
	if err != nil {
		return nil, err
	}
	counts := &SearchCounts{Games: len(matches), Platforms: Object{}}
	for _, match := range matches {
		current, _ := counts.Platforms.Get(match.Platform).(int)
		counts.Platforms.Set(match.Platform, current+1)
		if match.IsFavorite {
			counts.Favorites++
		}
	}
	if len(matches) > 0 {
		ids := make([]string, len(matches))
		for i, match := range matches {
			ids[i] = match.ID
		}
		// One list, not a parameter for each match: a broad search matches more games than a query takes parameters
		err := scope.Database.QueryRowContext(ctx,
			`SELECT count(DISTINCT rom_id) FROM launch_records WHERE user_id = ? AND status = ?
				AND rom_id IN (SELECT value FROM json_each(?))`,
			scope.User.ID, db.StatusNormal, string(mustJSON(ids))).Scan(&counts.History)
		if err != nil {
			return nil, err
		}
	}
	return counts, nil
}
