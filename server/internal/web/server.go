// Package web is the Go server's request pipeline, in the order of the Node server's src/server/create-server.ts.
package web

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"strings"

	"github.com/klauspost/compress/gzhttp"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/config"
)

type Server struct {
	authMode string
	config   config.Config
	database *sql.DB
	// The consoles whose game pages are sent with cross-origin isolation headers
	threadedConsoles map[string]bool
}

func New(c config.Config, database *sql.DB, authMode string, threadedConsoles []string) *Server {
	threaded := map[string]bool{}
	for _, name := range threadedConsoles {
		threaded[name] = true
	}
	return &Server{authMode: authMode, config: c, database: database, threadedConsoles: threaded}
}

// What a request carries once it's known who sent it
type state struct {
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
		current := &state{token: auth.Token(r)}
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
	if err != nil {
		return nil, err
	}

	// Stored files are mostly binary, and compressing them would drop their size from downloads for no gain
	compress, err := gzhttp.NewWrapper(gzhttp.MinSize(1024))
	if err != nil {
		return nil, err
	}

	api := http.NewServeMux()
	api.Handle("POST /api/v1/auth/login", compress(http.HandlerFunc(s.login)))
	api.Handle("POST /api/v1/auth/register", compress(http.HandlerFunc(s.register)))
	api.Handle("GET /api/v1/users/current", compress(http.HandlerFunc(s.currentUser)))
	api.HandleFunc("GET /api/v1/files/{id...}", s.file)
	api.HandleFunc("GET /logout", s.logout)
	// Not served by Go yet: answered as unavailable rather than with the page
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeMessage(w, http.StatusNotImplemented, "Not served by the Go server yet")
	})
	api.Handle("/", page)

	signedIn := s.globals(logger(api))

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
