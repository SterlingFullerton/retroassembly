// Package web is the Go server's request pipeline, in the order of the Node server's src/server/create-server.ts.
package web

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/gzhttp"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/cdn"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/gameinfo"
	"retroassembly/server/internal/i18n"
	"retroassembly/server/internal/nasgames"
	"retroassembly/server/internal/preference"
	"retroassembly/server/internal/psp"
	"retroassembly/server/internal/shared"
	"retroassembly/server/internal/together"
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
	// Failed sign-ins and sign-ins under way, by address and username
	signIns *signInLimit
	// The game service on the NAS, or nil when it isn't set up
	nasGames *nasgames.Client
	// Players' places in NAS games, kept for their answer (see nasPlaceKey)
	nasPlaces sync.Map
	// The emulators the NAS has, as last asked
	nasCoresCache struct {
		sync.Mutex
		at    time.Time
		cores []string
	}
	// Invitations to games being played together, waiting for a guest
	together *together.Invitations
	// The consoles whose game pages are sent with cross-origin isolation headers
	threadedConsoles map[string]bool
}

// adminID is the library's owner: the oldest admin still in use
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
	gameInfo := &gameinfo.Database{Path: gameinfo.DefaultPath(), Platforms: data.GameInfoPlatforms}
	var cache *cdn.Cache
	if c.CDNCache {
		cache = cdn.New(&cdn.Data{CDN: data.CDN}, c.Directories, c.CDNOffline, c.OIDC.ExtraCertificates)
		cache.Recheck = time.Duration(c.CDNRecheckDays * float64(24*time.Hour))
		cache.LaunchboxCovers = gameInfo.LaunchboxCover
		cache.KeepOriginals = c.CDNKeepOriginals
	}
	multiDisc := map[string]bool{}
	for _, console := range data.MultiDiscConsoles {
		multiDisc[console] = true
	}
	server := &Server{
		authMode: authMode, cdn: cache,
		compressor: &psp.Compressor{Database: database, FilePath: c.FilePath}, fileExtensions: data.FileExtensions,
		gameInfo:  gameInfo,
		multiDisc: multiDisc, multiDiscList: data.MultiDiscConsoles, config: c, database: database, languages: i18n.New(data),
		nasGames:      nasgames.New(c.NASGames.URL, c.NASGames.Key),
		oidc:          oidcProvider{client: oidcClient(c.OIDC.ExtraCertificates)},
		platformNames: data.PlatformNames, preference: settings, signIns: newSignInLimit(c.SignInAttempts), together: together.New(),
		threadedConsoles: threaded,
	}
	if server.nasGames != nil {
		go server.collectNASSaves()
	}
	return server, nil
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
		user, renewedUntil, err := auth.CurrentUser(r.Context(), s.database, current.token, s.authMode)
		if err != nil {
			writeError(w, err)
			return
		}
		// A session given more time keeps its cookie as long, or the browser would drop it 30 days after signing in
		if !renewedUntil.IsZero() {
			if cookie, err := r.Cookie("token"); err == nil && cookie.Value == current.token {
				setSessionCookie(w, r, current.token, renewedUntil)
			}
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

// fromAnotherSite tells whether a browser sent a request from a page somewhere else: another site, or another subdomain
// of this one. Browsers say so in Sec-Fetch-Site; older ones don't, but send Origin with a form posted or a script's
// request, which is then compared with the address the request came to. Requests from outside a browser send
// neither, and aren't from another site
func fromAnotherSite(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "cross-site" || site == "same-site"
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		// "null", from a sandboxed frame or a page opened from a file
		return true
	}
	host := r.Host
	if forwarded, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Host"), ","); strings.TrimSpace(forwarded) != "" {
		host = strings.TrimSpace(forwarded)
	}
	return !strings.EqualFold(parsed.Host, host)
}

// sameSiteWrites refuses a request that changes something when it comes from another site, or another subdomain of the
// same one: the session cookie is SameSite=Lax, which sends it with a form posted from a sibling subdomain, and a form
// posted to the login from anywhere would sign the browser in to someone else's account
func sameSiteWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if fromAnotherSite(r) {
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
	} else if err == nil {
		page.frameAncestors = s.config.FrameAncestors
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
		"POST /api/v1/auth/login":                              s.login,
		"POST /api/v1/auth/register":                           s.register,
		"PATCH /api/v1/auth/password":                          s.updatePassword,
		"GET /api/v1/users/current":                            s.currentUser,
		"POST /api/v1/favorites":                               s.signedIn(s.addFavorite),
		"DELETE /api/v1/favorites/{romId}":                     s.signedIn(s.removeFavorite),
		"POST /api/v1/launch_records":                          s.signedIn(s.addLaunchRecord),
		"DELETE /api/v1/roms/{id}/launch_records":              s.signedIn(s.removeLaunchRecords),
		"GET /api/v1/preference":                               s.signedIn(s.getPreference),
		"POST /api/v1/preference":                              s.signedIn(s.updatePreference),
		"POST /api/v1/preference/bioses":                       s.signedIn(s.addBIOS),
		"DELETE /api/v1/preference/bioses":                     s.signedIn(s.deleteBIOS),
		"GET /api/v1/states":                                   s.signedIn(s.listStates),
		"POST /api/v1/states":                                  s.signedIn(s.createState),
		"DELETE /api/v1/states/{id}":                           s.signedIn(s.deleteState),
		"GET /api/v1/roms/{id}/states":                         s.signedIn(s.listRomStates),
		"GET /api/v1/game_saves":                               s.signedIn(s.listGameSaves),
		"PATCH /api/v1/roms/{id}":                              s.signedIn(s.updateRom),
		"GET /api/v1/users":                                    s.signedIn(s.listAccounts),
		"POST /api/v1/users":                                   s.signedIn(s.addAccount),
		"PATCH /api/v1/users/{id}":                             s.signedIn(s.updateAccount),
		"POST /api/v1/users/current/delete":                    s.signedIn(s.deleteOwnAccount),
		"GET /api/v1/sessions":                                 s.signedIn(s.listSessions),
		"DELETE /api/v1/sessions/others":                       s.signedIn(s.endOtherSessions),
		"DELETE /api/v1/users/{id}":                            s.signedIn(s.deleteAccount),
		"PUT /api/v1/users/{id}/password":                      s.signedIn(s.resetPassword),
		"DELETE /api/v1/roms/{id}":                             s.signedIn(s.deleteRom),
		"DELETE /api/v1/roms":                                  s.signedIn(s.deleteRoms),
		"POST /api/v1/roms/{id}/boxart":                        s.signedIn(s.addBoxart),
		"DELETE /api/v1/roms/{id}/boxart":                      s.signedIn(s.removeBoxart),
		"POST /api/v1/roms/{id}/thumbnail":                     s.signedIn(s.addThumbnail),
		"DELETE /api/v1/roms/{id}/thumbnail/{thumbnailId...}":  s.signedIn(s.removeThumbnail),
		"POST /api/v1/game_saves":                              s.signedIn(s.createGameSave),
		"POST /api/v1/game_saves/{id}/restore":                 s.signedIn(s.restoreGameSave),
		"POST /api/v1/roms":                                    s.signedIn(s.createRom),
		"POST /api/v1/play_together/invitations":               s.signedIn(s.openInvitation),
		"GET /api/v1/play_together/invitations":                s.signedIn(s.listInvitations),
		"GET /api/v1/play_together/address":                    s.signedIn(s.ownAddress),
		"GET /api/v1/play_together/invitations/{code}":         s.signedIn(s.findInvitation),
		"POST /api/v1/play_together/invitations/{code}/answer": s.signedIn(s.answerInvitation),
		"GET /api/v1/play_together/invitations/{code}/answer":  s.signedIn(s.invitationAnswer),
		"DELETE /api/v1/play_together/invitations/{code}":      s.signedIn(s.closeInvitation),
		"POST /api/v1/nas_games":                               s.signedIn(s.startNASGame),
		"GET /api/v1/nas_games/cores":                          s.signedIn(s.nasCores),
		"GET /api/v1/nas_games/{code}/states":                  s.signedIn(s.nasStates),
		"POST /api/v1/nas_games/{code}/states":                 s.signedIn(s.saveNASState),
		"POST /api/v1/nas_games/{code}/states/{state}/load":    s.signedIn(s.loadNASState),
		"GET /api/v1/nas_games/{code}/states/{state}/picture":  s.signedIn(s.nasStatePicture),
		"DELETE /api/v1/nas_games/{code}":                      s.signedIn(s.stopNASGame),
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
	return forwardedClient(s.config.TrustedProxies, s.isolation(outer)), nil
}
