package web

import (
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
	invitation := map[string]string{"controls": "nes", "offer": "the offer", "title": "Balloon Fight"}
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", invitation))
	if len(opened.Code) != 6 {
		t.Fatalf("code %q", opened.Code)
	}
	path := "/api/v1/play_together/invitations/" + opened.Code

	// An invitation needs an offer
	host.expect(http.StatusBadRequest, host.json(http.MethodPost, "/api/v1/play_together/invitations", map[string]string{"title": "No offer"}))

	var found map[string]string
	guest.expectJSON(http.StatusOK, &found, guest.get(path))
	if found["offer"] != "the offer" || found["title"] != "Balloon Fight" || found["controls"] != "nes" {
		t.Fatalf("found %+v", found)
	}
	guest.expect(http.StatusNotFound, guest.get("/api/v1/play_together/invitations/NOSUCH"))

	guest.expect(http.StatusBadRequest, guest.json(http.MethodPost, path+"/answer", map[string]string{}))
	guest.expect(http.StatusOK, guest.json(http.MethodPost, path+"/answer", map[string]string{"answer": "the answer"}))
	// Only one guest joins
	other.expect(http.StatusConflict, other.json(http.MethodPost, path+"/answer", map[string]string{"answer": "another"}))

	// Only the host collects the answer
	other.expect(http.StatusNotFound, other.get(path+"/answer"))
	var answered map[string]string
	host.expectJSON(http.StatusOK, &answered, host.get(path+"/answer"))
	if answered["answer"] != "the answer" {
		t.Fatalf("answer %+v", answered)
	}
	// Collected, the invitation is gone
	guest.expect(http.StatusNotFound, guest.get(path))

	// A host withdraws their own invitation; someone else's request to changes nothing
	host.expectJSON(http.StatusOK, &opened, host.json(http.MethodPost, "/api/v1/play_together/invitations", invitation))
	path = "/api/v1/play_together/invitations/" + opened.Code
	other.expect(http.StatusOK, other.send(http.MethodDelete, path, "", nil))
	guest.expect(http.StatusOK, guest.get(path))
	host.expect(http.StatusOK, host.send(http.MethodDelete, path, "", nil))
	guest.expect(http.StatusNotFound, guest.get(path))
}
