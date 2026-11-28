package web

import (
	"net"
	"net/http"
	"testing"
)

func TestPlayingTogether(t *testing.T) {
	api := newAPI(t)
	host := api.register(t, "host")
	guest := api.register(t, "guest")
	other := api.register(t, "other")

	var opened struct {
		Code string `json:"code"`
	}
	invitation := map[string]string{
		"controls": "nes", "core": "fceumm", "offer": "the offer", "platform": "nes", "title": "Balloon Fight",
	}
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", invitation))
	if len(opened.Code) != 6 {
		t.Fatalf("code %q", opened.Code)
	}
	path := "/api/v1/play_together/invitations/" + opened.Code

	// An invitation needs an offer
	host.expect(http.StatusBadRequest, host.json(http.MethodPost, "/api/v1/play_together/invitations", map[string]string{"title": "No offer"}))

	var found map[string]string
	guest.expectJSON(http.StatusOK, &found, guest.get(path))
	if found["offer"] != "the offer" || found["title"] != "Balloon Fight" || found["controls"] != "nes" ||
		found["platform"] != "nes" || found["core"] != "fceumm" {
		t.Fatalf("found %+v", found)
	}
	guest.expect(http.StatusNotFound, guest.get("/api/v1/play_together/invitations/NOSUCH"))
	// Found, the game is the guest's to join: no one else is given the host's offer
	other.expect(http.StatusConflict, other.get(path))

	guest.expect(http.StatusBadRequest, guest.json(http.MethodPost, path+"/answer", map[string]string{}))
	guest.expect(http.StatusOK, guest.json(http.MethodPost, path+"/answer", map[string]string{"answer": "the answer"}))
	// Only one guest joins
	other.expect(http.StatusConflict, other.json(http.MethodPost, path+"/answer", map[string]string{"answer": "another"}))

	// Only the host collects the answer
	other.expect(http.StatusNotFound, other.get(path+"/answer"))
	var answered map[string]string
	host.expectJSON(http.StatusOK, &answered, host.get(path+"/answer"))
	// With who joined
	if answered["answer"] != "the answer" || answered["guest"] != "guest" {
		t.Fatalf("answer %+v", answered)
	}
	// Collected, the invitation is gone
	guest.expect(http.StatusNotFound, guest.get(path))

	// A game is shown to everyone signed in, with its host's name, unless the host asks for a code
	var listed []map[string]string
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", invitation))
	guest.expectJSON(http.StatusOK, &listed, guest.get("/api/v1/play_together/invitations"))
	if len(listed) != 1 || listed[0]["code"] != opened.Code || listed[0]["host"] != "host" || listed[0]["title"] != "Balloon Fight" ||
		listed[0]["offer"] != "" {
		t.Fatalf("listed %+v", listed)
	}
	coded := map[string]any{"controls": "nes", "listed": false, "offer": "the offer", "title": "Balloon Fight"}
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", coded))
	guest.expectJSON(http.StatusOK, &listed, guest.get("/api/v1/play_together/invitations"))
	if len(listed) != 0 {
		t.Fatalf("listed when a code is asked for: %+v", listed)
	}
	guest.expect(http.StatusOK, guest.get("/api/v1/play_together/invitations/"+opened.Code))

	// Each browser is told the address it reaches the server from
	var own map[string]string
	guest.expectJSON(http.StatusOK, &own, guest.get("/api/v1/play_together/address"))
	if net.ParseIP(own["address"]) == nil {
		t.Fatalf("address %+v", own)
	}

	// A host withdraws their own invitation; someone else's request to changes nothing
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", invitation))
	path = "/api/v1/play_together/invitations/" + opened.Code
	other.expect(http.StatusOK, other.send(http.MethodDelete, path, "", nil))
	guest.expect(http.StatusOK, guest.get(path))
	host.expect(http.StatusOK, host.send(http.MethodDelete, path, "", nil))
	guest.expect(http.StatusNotFound, guest.get(path))
}
