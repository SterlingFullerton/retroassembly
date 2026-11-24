package web

import (
	"log"
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
	end, err := s.signIns.begin(clientAddress(r), values["username"])
	if err != nil {
		writeError(w, err)
		return
	}
	session, user, err := auth.Login(r.Context(), s.database, values["username"], values["password"], client(r))
	end(outcomeOf(err))
	if err != nil {
		writeError(w, err)
		return
	}
	s.endReplacedSession(r, session)
	setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, loginAnswer{Session: session, User: user})
}

// endReplacedSession ends the session the browser was signed in with before it signed in again, which nothing would
// use any more: its cookie is about to be replaced. Left alone, each sign-in would leave another behind until it
// expired, and the list of signed-in devices would fill with them
func (s *Server) endReplacedSession(r *http.Request, session *auth.Session) {
	if previous := stateOf(r).token; previous != "" && previous != session.Token {
		if err := auth.InvalidateSession(r.Context(), s.database, previous); err != nil {
			log.Printf("The session signed in over wasn't ended: %v", err)
		}
	}
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
	end, err := s.signIns.begin(clientAddress(r), values["username"])
	if err != nil {
		writeError(w, err)
		return
	}
	user, err := s.signUp(r, values["username"], values["password"])
	if err != nil {
		// A refused sign-up says nothing about anyone's password, so it doesn't clear the wrong ones counted for a name
		end(notChecked)
		writeError(w, err)
		return
	}
	end(signedIn)
	// Signed in straight away. The Node server checks the new password again first, which costs another hash
	session, err := auth.StartPasswordSession(r.Context(), s.database, user.ID, client(r))
	if err != nil {
		writeError(w, err)
		return
	}
	s.endReplacedSession(r, session)
	setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, loginAnswer{Session: session, User: user})
}

// signUp adds an account from the login page: only the first, which is the admin, unless OPEN_SIGNUP lets anyone make
// one. Those are players, until an admin makes them more
func (s *Server) signUp(r *http.Request, username, password string) (*auth.User, error) {
	if !s.config.OpenSignup {
		return auth.RegisterFirst(r.Context(), s.database, username, password, s.authMode, client(r))
	}
	return auth.CreateUser(r.Context(), s.database, username, password, auth.RolePlayer, s.authMode, client(r))
}

// currentUser is whoever is signed in, or nothing; open to everyone
func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) {
	user := stateOf(r).user
	if user == nil {
		// Nothing at all, not null: the Node server answers JSON of undefined
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	// The session cookie is sent on links from other sites too (SameSite=Lax), so only the app itself may log out: a
	// link to /logout elsewhere would otherwise sign the player out
	if token := stateOf(r).token; token != "" && !fromAnotherSite(r) {
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
