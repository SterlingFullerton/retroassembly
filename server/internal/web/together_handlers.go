package web

import (
	"net/http"
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
	invitation := together.Invitation{
		Controls: check.String("controls", controls, controlsPresent, 0),
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

func (s *Server) findInvitation(w http.ResponseWriter, r *http.Request, _ library.Scope) {
	invitation, err := s.together.Find(r.PathValue("code"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, invitation)
}

func (s *Server) answerInvitation(w http.ResponseWriter, r *http.Request, _ library.Scope) {
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
