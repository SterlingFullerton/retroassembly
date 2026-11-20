// Package web is the Go server's request pipeline, in the order of the Node server's src/server/create-server.ts.
package web

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/klauspost/compress/gzhttp"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/cdn"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/gameinfo"
	"retroassembly/server/internal/i18n"
	"retroassembly/server/internal/preference"
	"retroassembly/server/internal/psp"
	"retroassembly/server/internal/shared"
)

type Server struct {
	authMode string
	// The server's copy of CDN files, when it keeps one
	cdn        *cdn.Cache
	compressor *psp.Compressor
	// The file extensions each console's games may have
	fileExtensions map[string][]string
	gameInfo       *gameinfo.Database
	// The consoles whose games come on several discs
	multiDisc     map[string]bool
	multiDiscList []string
	config        config.Config
	database      *sql.DB
	languages     *i18n.Languages
	oidc          oidcProvider
	// The key of each console's name in the translations, which is also the list of consoles the app has
	platformNames map[string]string
	preference    *preference.Settings
	// The consoles whose game pages are sent with cross-origin isolation headers
	threadedConsoles map[string]bool
}

// adminID is the admin's account: the oldest one still in use
func (s *Server) adminID(r *http.Request) (string, error) {
	return auth.AdminID(r.Context(), s.database)
}

func New(c config.Config, database *sql.DB, authMode string, data shared.Data) (*Server, error) {
	threaded := map[string]bool{}
	for _, name := range data.ThreadedConsoles {
		threaded[name] = true
	}
	settings, err := preference.New(data.DefaultPreference, data.Platforms)
	if err != nil {
		return nil, err
	}
	var cache *cdn.Cache
	if c.CDNCache {
		cache = cdn.New(&cdn.Data{CDN: data.CDN}, c.Directories, c.CDNOffline, c.OIDC.ExtraCertificates)
	}
	multiDisc := map[string]bool{}
	for _, console := range data.MultiDiscConsoles {
		multiDisc[console] = true
	}
	return &Server{
		authMode: authMode, cdn: cache,
		compressor: &psp.Compressor{Database: database, FilePath: c.FilePath}, fileExtensions: data.FileExtensions,
		gameInfo:  &gameinfo.Database{Path: gameinfo.DefaultPath(), Platforms: data.GameInfoPlatforms},
		multiDisc: multiDisc, multiDiscList: data.MultiDiscConsoles, config: c, database: database, languages: i18n.New(data),
		oidc:          oidcProvider{client: oidcClient(c.OIDC.ExtraCertificates)},
		platformNames: data.PlatformNames, preference: settings, threadedConsoles: threaded,
	}, nil
}

// What a request carries once it's known who sent it
type state struct {
	// The language the browser asks for
	language       string
	libraryOwnerID string
	token          string
	user           *auth.User
}

type stateKey struct{}

func stateOf(r *http.Request) *state {
	value, _ := r.Context().Value(stateKey{}).(*state)
	return value
}

// globals looks up who sent the request, as src/middlewares/globals.ts does
func (s *Server) globals(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := &state{language: s.languages.Detect(r.Header.Get("Accept-Language")), token: auth.Token(r)}
		user, err := auth.CurrentUser(r.Context(), s.database, current.token, s.authMode)
		if err != nil {
			writeError(w, err)
			return
		}
		if user != nil {
			current.user = user
			if current.libraryOwnerID, err = auth.LibraryOwnerID(r.Context(), s.database, user); err != nil {
				writeError(w, err)
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), stateKey{}, current)))
	})
}

var (
	gamePage     = regexp.MustCompile(`^/library/platform/([^/]+)/rom/[^/]`)
	workerScript = regexp.MustCompile(`\.worker-[\w-]+\.js$`)
)

// sameSiteWrites refuses a request that changes something when it comes from another site, or another subdomain of the
// same one: the session cookie is SameSite=Lax, which sends it with a form posted from a sibling subdomain, and a form
// posted to the login from anywhere would sign the browser in to someone else's account. Browsers say where a request
// comes from in Sec-Fetch-Site; requests from outside a browser don't, and aren't affected
func sameSiteWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" || site == "same-site" {
				writeMessage(w, http.StatusForbidden, "Requests from other sites are refused")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// isolation sends the game pages of consoles whose emulator runs on several threads (the PSP's) with cross-origin
// isolation headers. A stored file opened in a frame on such a page, and a worker such a page starts, allow it too
func (s *Server) isolation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		if match := gamePage.FindStringSubmatch(r.URL.Path); match != nil && s.threadedConsoles[match[1]] {
			header.Set("Cross-Origin-Embedder-Policy", "require-corp")
			header.Set("Cross-Origin-Opener-Policy", "same-origin")
		} else if strings.HasPrefix(r.URL.Path, "/api/v1/files/") || workerScript.MatchString(r.URL.Path) {
			header.Set("Cross-Origin-Embedder-Policy", "require-corp")
		}
		next.ServeHTTP(w, r)
	})
}

// Handler is the whole pipeline. Requests that need no user (the build's files, robots.txt) are answered first;
// everything after them looks up the signed-in user and is logged
func (s *Server) Handler() (http.Handler, error) {
	page, version, err := loadPage(s.config.ClientRoot)
	// Without the built browser app, as in development, where Vite serves it, only the API is served
	pages := http.Handler(page)
	if errors.Is(err, fs.ErrNotExist) {
		log.Printf("No built browser app at %s, so only the API is served", s.config.ClientRoot)
		pages, err = http.NotFoundHandler(), nil
	}
	if err != nil {
		return nil, err
	}

	compress, err := gzhttp.NewWrapper(gzhttp.MinSize(1024))
	if err != nil {
		return nil, err
	}

	api := http.NewServeMux()
	for pattern, handler := range map[string]http.HandlerFunc{
		"POST /api/v1/auth/login":                             s.login,
		"POST /api/v1/auth/register":                          s.register,
		"PATCH /api/v1/auth/password":                         s.updatePassword,
		"GET /api/v1/users/current":                           s.currentUser,
		"POST /api/v1/favorites":                              s.signedIn(s.addFavorite),
		"DELETE /api/v1/favorites/{romId}":                    s.signedIn(s.removeFavorite),
		"POST /api/v1/launch_records":                         s.signedIn(s.addLaunchRecord),
		"DELETE /api/v1/roms/{id}/launch_records":             s.signedIn(s.removeLaunchRecords),
		"GET /api/v1/preference":                              s.signedIn(s.getPreference),
		"POST /api/v1/preference":                             s.signedIn(s.updatePreference),
		"POST /api/v1/preference/bioses":                      s.signedIn(s.addBIOS),
		"DELETE /api/v1/preference/bioses":                    s.signedIn(s.deleteBIOS),
		"GET /api/v1/states":                                  s.signedIn(s.listStates),
		"POST /api/v1/states":                                 s.signedIn(s.createState),
		"DELETE /api/v1/states/{id}":                          s.signedIn(s.deleteState),
		"GET /api/v1/roms/{id}/states":                        s.signedIn(s.listRomStates),
		"GET /api/v1/game_saves":                              s.signedIn(s.listGameSaves),
		"PATCH /api/v1/roms/{id}":                             s.signedIn(s.updateRom),
		"GET /api/v1/users":                                   s.signedIn(s.listAccounts),
		"POST /api/v1/users":                                  s.signedIn(s.addAccount),
		"PATCH /api/v1/users/{id}":                            s.signedIn(s.setLibraryMode),
		"DELETE /api/v1/users/{id}":                           s.signedIn(s.deleteAccount),
		"DELETE /api/v1/roms/{id}":                            s.signedIn(s.deleteRom),
		"DELETE /api/v1/roms":                                 s.signedIn(s.deleteRoms),
		"POST /api/v1/roms/{id}/boxart":                       s.signedIn(s.addBoxart),
		"DELETE /api/v1/roms/{id}/boxart":                     s.signedIn(s.removeBoxart),
		"POST /api/v1/roms/{id}/thumbnail":                    s.signedIn(s.addThumbnail),
		"DELETE /api/v1/roms/{id}/thumbnail/{thumbnailId...}": s.signedIn(s.removeThumbnail),
		"POST /api/v1/game_saves":                             s.signedIn(s.createGameSave),
		"POST /api/v1/game_saves/{id}/restore":                s.signedIn(s.restoreGameSave),
		"POST /api/v1/roms":                                   s.signedIn(s.createRom),
	} {
		api.Handle(pattern, compress(handler))
	}
	for pattern, handler := range map[string]http.HandlerFunc{
		"GET /api/v1/launch_records":     s.signedIn(s.launchHistory),
		"GET /api/v1/roms/rediscover":    s.signedIn(s.rediscoverPicks),
		"GET /api/v1/roms/on_this_day":   s.signedIn(s.onThisDayPicks),
		"GET /api/v1/roms/play_together": s.signedIn(s.playTogetherPicks),
		"GET /api/v1/roms/search":        s.signedIn(s.searchRoms),
		// The pages with lists of games
		"GET /api/v1/pages/library":           s.signedIn(s.libraryLayoutData),
		"GET /api/v1/pages/library/home":      s.signedIn(s.homePageData),
		"GET /api/v1/pages/library/roms":      s.signedIn(s.gamesPageData),
		"GET /api/v1/pages/library/consoles":  s.signedIn(s.consolesPageData),
		"GET /api/v1/pages/library/favorites": s.signedIn(s.favoritesPageData),
		"GET /api/v1/pages/library/history":   s.signedIn(s.historyPageData),
		"GET /api/v1/pages/library/platform":  s.signedIn(s.platformPageData),
		"GET /api/v1/pages/library/rom":       s.signedIn(s.romPageData),
	} {
		api.Handle(pattern, compress(handler))
	}
	api.Handle("GET /api/v1/pages/common", compress(http.HandlerFunc(s.commonPageData)))
	api.Handle("GET /api/v1/pages/login", compress(http.HandlerFunc(s.loginPageData)))
	api.Handle("GET /api/v1/roms/by_files", compress(s.signedIn(s.romsByFiles)))
	api.Handle("GET /api/v1/roms/search_counts", compress(s.signedIn(s.searchCounts)))
	// Stored files are mostly binary, and compressing them would drop their size from downloads for no gain
	api.Handle("GET /api/v1/roms/{id}/content", s.signedIn(s.romContent))
	api.HandleFunc("GET /api/v1/files/{id...}", s.file)
	api.HandleFunc("GET /logout", s.logout)
	// Without the cache, /cdn/ is just another page address, as on the Node server. Its files aren't compressed
	if s.cdn != nil {
		api.HandleFunc("GET /cdn/", s.cdnFile)
	}
	api.HandleFunc("GET /login/oidc", s.loginWithOIDC)
	api.HandleFunc("GET "+oidcCallbackPath, s.oidcCallback)
	api.Handle("/", pages)

	signedIn := s.globals(logger(sameSiteWrites(api)))

	outer := http.NewServeMux()
	// A private library, kept out of search engines
	outer.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
		w.Write([]byte("User-agent: *\nDisallow: /"))
	})
	// The library is the app's front page
	outer.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		redirect(w, "/library")
	})
	// Which build is running, so pages that are already open can tell the site has been updated under them
	outer.HandleFunc("GET /build-version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
		w.Write([]byte(version))
	})
	outer.Handle("/", staticFiles(s.config.ClientRoot, signedIn))
	return s.isolation(outer), nil
}
