package web

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/files"
)

func client(r *http.Request) auth.Client {
	return auth.Client{IP: clientAddress(r), UserAgent: r.UserAgent()}
}

// isSecure tells whether the browser reached the app over https, directly or through a proxy that says so
func isSecure(r *http.Request) bool {
	if protocol, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ","); strings.TrimSpace(protocol) != "" {
		switch strings.TrimSpace(protocol) {
		case "https":
			return true
		case "http":
			return false
		}
	}
	return r.TLS != nil
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, session *auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Expires:  time.Time(session.ExpiresAt),
		HttpOnly: true,
		Name:     "token",
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure(r),
		Value:    session.Token,
	})
}

type loginAnswer struct {
	Session *auth.Session `json:"session"`
	User    *auth.User    `json:"user"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	values, ok := form(w, r, "password", "username")
	if !ok {
		return
	}
	if s.authMode != "local" {
		writeMessage(w, http.StatusForbidden, "Password login is disabled")
		return
	}
	session, user, err := auth.Login(r.Context(), s.database, values["username"], values["password"], client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, loginAnswer{Session: session, User: user})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	values, ok := form(w, r, "password", "username")
	if !ok {
		return
	}
	if s.authMode != "local" {
		writeMessage(w, http.StatusForbidden, "Password registration is disabled")
		return
	}
	user, err := auth.CreateUser(r.Context(), s.database, values["username"], values["password"], s.authMode, client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	// Signed in straight away. The Node server checks the new password again first, which costs another hash
	session, err := auth.StartPasswordSession(r.Context(), s.database, user.ID, client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, loginAnswer{Session: session, User: user})
}

// currentUser is whoever is signed in, or nothing; open to everyone
func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) {
	user := stateOf(r).user
	if user == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	// The session cookie is sent on links from other sites too (SameSite=Lax), so only the app itself may log out: a
	// link to /logout elsewhere would otherwise sign the player out
	site := r.Header.Get("Sec-Fetch-Site")
	fromElsewhere := site == "cross-site" || site == "same-site"
	if token := stateOf(r).token; token != "" && !fromElsewhere {
		if err := auth.InvalidateSession(r.Context(), s.database, token); err != nil {
			writeError(w, err)
			return
		}
		http.SetCookie(w, &http.Cookie{MaxAge: -1, Name: "token", Path: "/"})
	}
	redirect(w, "/")
}

// file sends a stored file the signed-in user may read. Someone else's file is answered as if it didn't exist
func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	current := stateOf(r)
	if current.user == nil {
		writeMessage(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	id := r.PathValue("id")
	reader := files.Reader{LibraryOwnerID: current.libraryOwnerID, UserID: current.user.ID}
	allowed, err := files.CanRead(r.Context(), s.database, reader, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if !allowed {
		notFound(w)
		return
	}
	if host := s.config.StorageHost; host != "" {
		base, err := url.Parse(host)
		if err != nil {
			writeError(w, err)
			return
		}
		target, err := base.Parse(id)
		if err != nil {
			writeError(w, err)
			return
		}
		redirect(w, target.String())
		return
	}
	filePath, ok := s.config.FilePath(id)
	if !ok {
		notFound(w)
		return
	}
	files.Serve(w, r, id, filePath)
}

func notFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte("404 Not Found"))
}
