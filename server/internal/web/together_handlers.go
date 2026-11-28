package web

import (
	"net"
	"net/http"
	"strings"
	"time"

	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
	"retroassembly/server/internal/together"
)

// Playing a game together: the server introduces the host's browser and a guest's, which then talk to each other
// directly (see the together package). Anyone signed in may host or join; the code is what lets a guest in

// How long a host's request for the guest's answer is held open before it's told to ask again. Short enough that
// nothing between the browser and the server gives up on it first
const answerWait = 20 * time.Second

func (s *Server) openInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	body, ok := readJSON(w, r)
	if !ok {
		return
	}
	object, _ := body.(preference.Object)
	var check validation
	offer, present := object["offer"]
	title, titlePresent := object["title"]
	controls, controlsPresent := object["controls"]
	core, corePresent := object["core"]
	platform, platformPresent := object["platform"]
	// Shown to everyone signed in unless the host asks for a code
	listed, isBool := object["listed"].(bool)
	coreName, _ := check.OptionalString("core", core, corePresent, 0, 64)
	platformName, _ := check.OptionalString("platform", platform, platformPresent, 0, 64)
	invitation := together.Invitation{
		Controls: check.String("controls", controls, controlsPresent, 0),
		Core:     coreName,
		Platform: platformName,
		Host:     scope.User.Username,
		Listed:   listed || !isBool,
		Offer:    check.String("offer", offer, present, 1),
		Title:    check.String("title", title, titlePresent, 0),
	}
	if check.Failed(w) {
		return
	}
	code, err := s.together.Open(scope.User.ID, invitation)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": code})
}

func (s *Server) findInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	if id, isNAS := nasGameID(r.PathValue("code")); isNAS {
		s.findNASInvitation(w, r, scope, r.PathValue("code"), id)
		return
	}
	invitation, err := s.together.Find(r.PathValue("code"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, invitation)
}

func (s *Server) answerInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	body, ok := readJSON(w, r)
	if !ok {
		return
	}
	object, _ := body.(preference.Object)
	var check validation
	value, present := object["answer"]
	answer := check.String("answer", value, present, 1)
	if check.Failed(w) {
		return
	}
	if id, isNAS := nasGameID(r.PathValue("code")); isNAS {
		// The place in a game on the NAS the answer is for, as its invitation gave it
		place, _ := object["place"].(string)
		s.answerNASInvitation(w, r, scope, id, place, answer)
		return
	}
	if err := s.together.Answer(r.PathValue("code"), answer); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, true)
}

// The host asks for the guest's answer and is kept waiting for it: answered as soon as it arrives, or with null after
// a while, to ask again
func (s *Server) invitationAnswer(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	answer, err := s.together.WaitForAnswer(r.Context(), r.PathValue("code"), scope.User.ID, answerWait)
	if err != nil {
		writeError(w, err)
		return
	}
	if answer == "" {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"answer": answer})
}

func (s *Server) closeInvitation(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	s.together.Close(r.PathValue("code"), scope.User.ID)
	writeJSON(w, http.StatusOK, nil)
}

// The games anyone signed in may join without a code: those people are sharing, then those running on the NAS
func (s *Server) listInvitations(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	writeJSON(w, http.StatusOK, append(s.together.List(), s.nasListings(r.Context())...))
}

// The address the request came from, as the server sees it. Two browsers that both reach the server can usually reach
// each other at these addresses, which a browser won't tell its own page; each asks here for its own
func (s *Server) ownAddress(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	address := r.Header.Get("X-Forwarded-For")
	// A request passed along more than once lists each step; the first is where it began
	if first, _, several := strings.Cut(address, ","); several {
		address = first
	}
	address = strings.TrimSpace(address)
	if address == "" {
		address = strings.TrimSpace(r.Header.Get("X-Real-IP"))
	}
	if address == "" {
		address = clientAddress(r)
	}
	if net.ParseIP(address) == nil {
		address = ""
	}
	writeJSON(w, http.StatusOK, map[string]string{"address": address})
}
