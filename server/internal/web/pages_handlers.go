package web

import (
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf16"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
)

// isLibraryPath tells whether a page is one of the library's, which are in the user's chosen language
func isLibraryPath(pagePath string) bool {
	return pagePath == "/library" || strings.HasPrefix(pagePath, "/library/")
}

// pageLanguage is the language a page is in: on the library's pages the one the user chose in their settings, unless
// that's automatic; elsewhere, and then, the one the browser asks for. One the app doesn't have is English
func (s *Server) pageLanguage(detected, pagePath string, settings preference.Object) string {
	language := detected
	if isLibraryPath(pagePath) {
		ui, _ := settings["ui"].(preference.Object)
		if chosen, _ := ui["language"].(string); chosen != "" && chosen != "auto" {
			language = chosen
		}
	}
	if !s.languages.Supports(language) {
		return "en"
	}
	return language
}

// librarySettings is the user's settings and the consoles they show, with the scope in the language of the library's
// pages
func (s *Server) librarySettings(r *http.Request, scope library.Scope) (library.Scope, preference.Object, []string, error) {
	resolved, err := s.preference.Get(r.Context(), s.database, scope.User.ID, scope.LibraryOwnerID)
	if err != nil {
		return scope, nil, nil, err
	}
	scope.Language = s.pageLanguage(scope.Language, "/library", resolved)
	ui, _ := resolved["ui"].(preference.Object)
	values, _ := ui["platforms"].([]any)
	platforms := make([]string, 0, len(values))
	for _, value := range values {
		if name, ok := value.(string); ok {
			platforms = append(platforms, name)
		}
	}
	return scope, resolved, platforms, nil
}

func envOr(name, fallback string) string {
	if value, ok := config.Lookup(name); ok {
		return value
	}
	return fallback
}

// GET /api/v1/pages/common: what every page shares; path is the page's, which decides its language
func (s *Server) commonPageData(w http.ResponseWriter, r *http.Request) {
	current := stateOf(r)
	pagePath := r.URL.Query().Get("path")
	if !r.URL.Query().Has("path") {
		pagePath = "/"
	}
	var settings preference.Object
	if current.user != nil {
		var err error
		if settings, err = s.settings(r, current.user, current.libraryOwnerID); err != nil {
			writeError(w, err)
			return
		}
	}
	data := obj("authMode", s.authMode, "cdnCache", s.config.CDNCache)
	if current.user != nil {
		data = append(data, library.Field{Key: "currentUser", Value: current.user})
	}
	data = append(data,
		library.Field{Key: "detectedLanguage", Value: current.language},
		// The limits the browser checks, as they're set: the Node server sends the settings' text, not numbers
		library.Field{Key: "env", Value: obj(
			"MAX_AUTO_STATES", envOr("MAX_AUTO_STATES", "20"),
			"MAX_ROMS", envOr("MAX_ROMS", ""),
			"MAX_UPLOAD", envOr("MAX_UPLOAD", "1000"),
		)},
		library.Field{Key: "isLikelyDesktop", Value: r.Header.Get("Sec-Ch-Ua-Mobile") != "?1"},
		library.Field{Key: "language", Value: s.pageLanguage(current.language, pagePath, settings)},
	)
	if settings != nil {
		data = append(data, library.Field{Key: "preference", Value: settings})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "title", Value: ""}))
}

// safeRedirectTo is where to go after logging in: a path on this site, or the library
func safeRedirectTo(value string) string {
	const fallback = "/library"
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, `\`) {
		return fallback
	}
	base, _ := url.Parse("https://retroassembly.invalid")
	target, err := base.Parse(value)
	if err != nil || target.Host != base.Host || target.Scheme != base.Scheme || strings.HasPrefix(target.EscapedPath(), "//") {
		return fallback
	}
	result := target.EscapedPath()
	if target.RawQuery != "" {
		result += "?" + target.RawQuery
	}
	if target.Fragment != "" {
		result += "#" + target.EscapedFragment()
	}
	return result
}

// GET /api/v1/pages/login: which form the login page shows, or where to go for someone already signed in
func (s *Server) loginPageData(w http.ResponseWriter, r *http.Request) {
	current := stateOf(r)
	query := r.URL.Query()
	redirectTo := safeRedirectTo(query.Get("redirect_to"))
	if current.user != nil {
		writeJSON(w, http.StatusOK, obj("redirect", redirectTo))
		return
	}
	language := current.language
	title := s.languages.T(language, "auth.login", nil)
	if s.authMode == "oidc" {
		var loginError any
		if code := query.Get("error"); code != "" {
			loginError = obj("message", s.languages.T(language, "auth."+code, nil))
		}
		writeJSON(w, http.StatusOK, obj("error", loginError, "formType", "oidc", "redirectTo", redirectTo, "title", title))
		return
	}
	var users int
	if err := s.database.QueryRowContext(r.Context(), `SELECT count(*) FROM users WHERE status = 1`).Scan(&users); err != nil {
		writeError(w, err)
		return
	}
	formType := "register"
	if users > 0 {
		formType = "login"
	}
	writeJSON(w, http.StatusOK, obj("error", nil, "formType", formType, "redirectTo", redirectTo,
		"signupOpen", s.config.OpenSignup, "title", title))
}

// GET /api/v1/pages/library: what every library page shares: the games played most recently, and whether the user is
// the admin
func (s *Server) libraryLayoutData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	recent, err := library.LaunchHistory(r.Context(), scope, platforms, 1, 20, "")
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(recent.Roms); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, obj("isAdmin", scope.User.IsAdmin(), "recentlyLaunchedRoms", recent.Roms))
}

// listQuery is a game list's sort, order, page and search, from the page's address, as getRomsQuery reads them
func listQuery(r *http.Request) library.ListQuery {
	values := r.URL.Query()
	search := strings.Join(strings.Fields(values.Get("q")), " ")
	if units := utf16.Encode([]rune(search)); len(units) > 100 {
		search = string(utf16.Decode(units[:100]))
	}
	order := library.ListOrder(values.Get("sort"), search != "")
	direction := values.Get("direction")
	if direction != "asc" && direction != "desc" {
		direction = library.DefaultDirection(order)
	}
	// A page the address can't mean, such as Infinity or 2.5, is the first
	page := jsNumber(values.Get("page"))
	if !(page >= 1) || page > maxPage || page != math.Trunc(page) {
		page = 1
	}
	return library.ListQuery{
		Direction: direction, Favorite: values.Get("favorite") == "1", OrderBy: order, Page: page, Search: search,
	}
}

// letters is where each letter starts, for a list sorted by name on more than one page; nothing otherwise
func letters(r *http.Request, scope library.Scope, platforms []string, query library.ListQuery, list *library.RomList, favorite bool, platform string) (any, error) {
	if query.OrderBy != "name" || list.Pagination.Pages <= 1 {
		return nil, nil
	}
	return library.Letters(r.Context(), scope, platforms, library.LettersQuery{
		Direction: query.Direction, Favorite: favorite, IDs: list.MatchIDs, Platform: platform,
	})
}

// listPage is a game list's page data, with letters and the search when there are some
func listPage(fields library.Object, lettersValue any, list *library.RomList, extra ...library.Field) library.Object {
	if lettersValue != nil {
		fields = append(fields, library.Field{Key: "letters", Value: lettersValue})
	}
	fields = append(fields, library.Field{Key: "pagination", Value: list.Pagination})
	fields = append(fields, extra...)
	return fields
}

// GET /api/v1/pages/library/roms: the Games page
func (s *Server) gamesPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	query := listQuery(r)
	list, err := library.GetRoms(r.Context(), scope, platforms, query)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(list.Roms); err != nil {
		writeError(w, err)
		return
	}
	platformCount, err := library.PlatformCount(r.Context(), scope, platforms)
	if err != nil {
		writeError(w, err)
		return
	}
	lettersValue, err := letters(r, scope, platforms, query, list, query.Favorite, "")
	if err != nil {
		writeError(w, err)
		return
	}
	data := listPage(nil, lettersValue, list, library.Field{Key: "platformCount", Value: platformCount},
		library.Field{Key: "roms", Value: list.Roms})
	if list.Search != nil {
		data = append(data, library.Field{Key: "search", Value: list.Search})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "title", Value: scope.T("common.games", nil)}))
}

// GET /api/v1/pages/library/favorites: the Favorites page
func (s *Server) favoritesPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	query := listQuery(r)
	query.Favorite = true
	list, err := library.GetRoms(r.Context(), scope, platforms, query)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(list.Roms); err != nil {
		writeError(w, err)
		return
	}
	lettersValue, err := letters(r, scope, platforms, query, list, true, "")
	if err != nil {
		writeError(w, err)
		return
	}
	data := listPage(nil, lettersValue, list, library.Field{Key: "roms", Value: list.Roms})
	if list.Search != nil {
		data = append(data, library.Field{Key: "search", Value: list.Search})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "title", Value: scope.T("nav.favorites", nil)}))
}

// GET /api/v1/pages/library/history: the History page
func (s *Server) historyPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	query := listQuery(r)
	history, err := library.LaunchHistory(r.Context(), scope, platforms, query.Page, 100, query.Search)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(history.Roms); err != nil {
		writeError(w, err)
		return
	}
	data := obj("page", query.Page, "pagination", history.Pagination, "roms", history.Roms)
	if query.Search != "" {
		data = append(data, library.Field{Key: "search", Value: obj("query", query.Search)})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "title", Value: scope.T("nav.history", nil)}))
}

// GET /api/v1/pages/library/consoles: how many games each console has
func (s *Server) consolesPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	consoles, err := library.Overview(r.Context(), scope, platforms)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, obj("consoles", consoles, "title", scope.T("nav.consoles", nil)))
}

func (s *Server) notFoundPage(w http.ResponseWriter) {
	writeMessage(w, http.StatusNotFound, "Not Found")
}

// GET /api/v1/pages/library/platform: a console's games. The library's SNES games were once filed as Super Famicom;
// with none left there, its page leads to SNES's
func (s *Server) platformPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	value, present := field(r.URL.Query(), "platform")
	platform := check.String("platform", value, present, 0)
	if check.Failed(w) {
		return
	}
	scope, _, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	if platform == "sfc" {
		var id string
		err := s.database.QueryRowContext(r.Context(),
			`SELECT id FROM roms WHERE user_id = ? AND status = 1 AND platform = 'sfc' LIMIT 1`,
			scope.LibraryOwnerID).Scan(&id)
		if err != nil {
			writeJSON(w, http.StatusOK, obj("redirect", obj("platform", "snes")))
			return
		}
	}
	nameKey, known := s.platformNames[platform]
	if !known {
		s.notFoundPage(w)
		return
	}
	query := listQuery(r)
	query.Platform = platform
	list, err := library.GetRoms(r.Context(), scope, platforms, query)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(list.Roms); err != nil {
		writeError(w, err)
		return
	}
	lettersValue, err := letters(r, scope, platforms, query, list, query.Favorite, platform)
	if err != nil {
		writeError(w, err)
		return
	}
	data := listPage(obj("favorite", query.Favorite), lettersValue, list,
		library.Field{Key: "platform", Value: platform}, library.Field{Key: "roms", Value: list.Roms})
	if list.Search != nil {
		data = append(data, library.Field{Key: "search", Value: list.Search})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "title", Value: scope.T(nameKey, nil)}))
}

// emulatorCore is the emulator the user plays a console's games with
func emulatorCore(settings preference.Object, platform string) string {
	emulator, _ := settings["emulator"].(preference.Object)
	platforms, _ := emulator["platform"].(preference.Object)
	console, _ := platforms[platform].(preference.Object)
	core, _ := console["core"].(string)
	return core
}

// GET /api/v1/pages/library/rom: a game's page. A game on several discs has one page, its first disc's
func (s *Server) romPageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	var check validation
	fileNameValue, fileNamePresent := field(r.URL.Query(), "file_name")
	fileName := check.String("file_name", fileNameValue, fileNamePresent, 1)
	platformValue, platformPresent := field(r.URL.Query(), "platform")
	platform := check.String("platform", platformValue, platformPresent, 0)
	if check.Failed(w) {
		return
	}
	if _, known := s.platformNames[platform]; !known {
		s.notFoundPage(w)
		return
	}
	scope, settings, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	var rom library.Object
	id, err := library.FindRomByFile(r.Context(), scope, platform, fileName)
	if err == nil && id != "" {
		rom, err = library.GetRom(r.Context(), scope, platforms, id)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	if rom == nil {
		// The library's SNES games were once filed as Super Famicom; a link from then leads to the same game under SNES
		if platform == "sfc" {
			writeJSON(w, http.StatusOK, obj("redirect", obj("fileName", fileName, "platform", "snes")))
			return
		}
		s.notFoundPage(w)
		return
	}
	romID := rom.Get("id").(string)
	discs, err := library.Discs(r.Context(), scope, platform, rom.Get("discGroup"))
	if err != nil {
		writeError(w, err)
		return
	}
	if len(discs) > 0 && discs[0].ID != romID {
		writeJSON(w, http.StatusOK, obj("redirect", obj("fileName", discs[0].FileName, "platform", platform)))
		return
	}
	core := emulatorCore(settings, platform)
	// Every snapshot this game's emulator can load, newest first: the newest is the one Continue uses
	states, err := library.GetStates(r.Context(), scope, library.StatesQuery{Core: core, Rom: romID, Type: "any"})
	if err != nil {
		writeError(w, err)
		return
	}
	data := obj("discs", discs)
	// The game's own save, put back before it boots
	var gameSave *library.GameSave
	if core != "" {
		gameSave, err = library.LatestGameSave(r.Context(), scope, core, romID)
		if err != nil {
			writeError(w, err)
			return
		}
		if gameSave != nil {
			data = append(data, library.Field{Key: "gameSave", Value: gameSave})
		}
	}
	// Which of its pictures the server has, including libretro's box art matched by title
	withCovers := []library.Object{rom}
	if err := s.withCovers(withCovers); err != nil {
		writeError(w, err)
		return
	}
	rom = withCovers[0]
	data = append(data, library.Field{Key: "rom", Value: rom})
	if len(states) > 0 {
		data = append(data, library.Field{Key: "state", Value: states[0]})
	}
	if len(states) > 0 && saveIsNewer(gameSave, states[0]) {
		data = append(data, library.Field{Key: "startFromSave", Value: true})
	}
	writeJSON(w, http.StatusOK, append(data, library.Field{Key: "states", Value: states},
		library.Field{Key: "title", Value: library.RomTitle(rom)}))
}

// A save a browser uploads on leaving a game is made with its snapshot, and can be stored a moment after it. Only one
// newer by more than this is progress the snapshot doesn't have
const browserSaveMargin = time.Minute

// saveIsNewer is whether a game's own save holds progress its newest snapshot doesn't: one made on the server, or put
// back from an older version, after the snapshot, or one from a browser well after it. Continuing from the snapshot
// would then put the game back to before the save, so the game's page starts from the save instead
func saveIsNewer(save *library.GameSave, state *library.State) bool {
	if save == nil || state == nil {
		return false
	}
	saved, snapshot := time.Time(save.CreatedAt), time.Time(state.CreatedAt)
	if save.ClientID != nil {
		return saved.After(snapshot.Add(browserSaveMargin))
	}
	return saved.After(snapshot)
}

// GET /api/v1/pages/library/home: the game to continue, and Home's rows
func (s *Server) homePageData(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	scope, settings, platforms, err := s.librarySettings(r, scope)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx := r.Context()
	// The games with saves, newest first: the first to continue, the next few as "Also in progress"
	recentlySaved, err := library.RomsWithStates(ctx, scope, platforms, 9)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(recentlySaved); err != nil {
		writeError(w, err)
		return
	}
	// Home's rows show their first games, never how many there are
	newAdded, err := library.GetRoms(ctx, scope, platforms,
		library.ListQuery{Direction: "desc", OrderBy: "added", PageSize: 20, WithoutTotal: true})
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(newAdded.Roms); err != nil {
		writeError(w, err)
		return
	}
	launched, err := library.LaunchHistory(ctx, scope, platforms, 1, 1, "")
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.withCovers(launched.Roms); err != nil {
		writeError(w, err)
		return
	}
	consoles, err := library.Overview(ctx, scope, platforms)
	if err != nil {
		writeError(w, err)
		return
	}

	// Why this game is at the top, for its label
	var rom library.Object
	heroReason := "added"
	switch {
	case len(recentlySaved) > 0:
		rom, heroReason = recentlySaved[0], "saved"
	case len(launched.Roms) > 0:
		rom, heroReason = launched.Roms[0], "played"
	case len(newAdded.Roms) > 0:
		rom = newAdded.Roms[0]
	}
	discs := []library.Disc{}
	var state, gameSave any
	if rom != nil {
		romID, _ := rom.Get("id").(string)
		romPlatform, _ := rom.Get("platform").(string)
		core := emulatorCore(settings, romPlatform)
		states, err := library.GetStates(ctx, scope, library.StatesQuery{Core: core, Limit: 1, Rom: romID, Type: "any"})
		if err != nil {
			writeError(w, err)
			return
		}
		if len(states) > 0 {
			state = states[0]
		}
		// A game on several discs is played with all of them
		full, err := library.GetRom(ctx, scope, platforms, romID)
		if err != nil {
			writeError(w, err)
			return
		}
		if full != nil {
			if discs, err = library.Discs(ctx, scope, romPlatform, full.Get("discGroup")); err != nil {
				writeError(w, err)
				return
			}
		}
		// The game's own save, put back before it boots
		if core != "" {
			save, err := library.LatestGameSave(ctx, scope, core, romID)
			if err != nil {
				writeError(w, err)
				return
			}
			if save != nil {
				gameSave = save
			}
		}
	}
	inProgress := []library.Object{}
	for _, saved := range recentlySaved {
		if rom == nil || saved.Get("id") != rom.Get("id") {
			inProgress = append(inProgress, saved)
		}
	}
	if len(inProgress) > 8 {
		inProgress = inProgress[:8]
	}
	var romValue any
	if rom != nil {
		romValue = rom
	}
	data := obj("discs", discs)
	if gameSave != nil {
		data = append(data, library.Field{Key: "gameSave", Value: gameSave})
	}
	writeJSON(w, http.StatusOK, append(data,
		library.Field{Key: "heroReason", Value: heroReason},
		library.Field{Key: "inProgressRoms", Value: inProgress},
		library.Field{Key: "newAddedRoms", Value: newAdded.Roms},
		library.Field{Key: "overview", Value: obj("consoles", consoles)},
		library.Field{Key: "recentlySavedRoms", Value: recentlySaved},
		library.Field{Key: "rom", Value: romValue},
		library.Field{Key: "state", Value: state},
		library.Field{Key: "title", Value: ""},
	))
}
