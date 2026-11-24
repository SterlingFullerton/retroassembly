package web

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

type gameList struct {
	Pagination struct {
		Total int `json:"total"`
	} `json:"pagination"`
	Redirect *struct {
		FileName string `json:"fileName"`
		Platform string `json:"platform"`
	} `json:"redirect"`
	Roms  []game `json:"roms"`
	Title string `json:"title"`
}

func gameIDs(games []game) []string {
	list := make([]string, len(games))
	for i, each := range games {
		list[i] = each.ID
	}
	return list
}

func TestPlayHistory(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	first, second := player.addGame("First.nes"), player.addGame("Second.nes")
	play := func(user *apiUser, romID string) response {
		// Plays are ordered by the millisecond they were recorded in, so each is given one of its own
		time.Sleep(2 * time.Millisecond)
		return user.form(http.MethodPost, "/api/v1/launch_records", url.Values{"core": {"fceumm"}, "rom": {romID}})
	}

	player.expect(http.StatusOK, play(player, first.ID))
	player.expect(http.StatusOK, play(player, second.ID))
	player.expect(http.StatusOK, play(player, first.ID))
	// Someone else's plays are their own history
	other.expect(http.StatusOK, play(other, first.ID))

	var history gameList
	player.expectJSON(http.StatusOK, &history, player.get("/api/v1/launch_records"))
	if got := gameIDs(history.Roms); len(got) != 2 || got[0] != first.ID || got[1] != second.ID || history.Pagination.Total != 2 {
		t.Fatalf("history: %+v", history)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/launch_records?page=first"))
	player.expectJSON(http.StatusOK, &history, player.get("/api/v1/pages/library/history"))
	if len(history.Roms) != 2 || history.Title == "" {
		t.Fatalf("history page: %+v", history)
	}
	player.expectJSON(http.StatusOK, &history, player.get("/api/v1/pages/library/history?q=second"))
	if got := gameIDs(history.Roms); len(got) != 1 || got[0] != second.ID {
		t.Fatalf("history searched: %+v", history)
	}

	// Another player's history is their own, and they can't clear the player's
	other.expectJSON(http.StatusOK, &history, other.get("/api/v1/launch_records"))
	if got := gameIDs(history.Roms); len(got) != 1 || got[0] != first.ID {
		t.Fatalf("the other player's history: %+v", history)
	}
	other.expect(http.StatusOK, other.send(http.MethodDelete, "/api/v1/roms/"+first.ID+"/launch_records", "", nil))
	player.expectJSON(http.StatusOK, &history, player.get("/api/v1/launch_records"))
	if len(history.Roms) != 2 {
		t.Fatalf("history after another player cleared it: %+v", history)
	}

	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+first.ID+"/launch_records", "", nil))
	player.expectJSON(http.StatusOK, &history, player.get("/api/v1/launch_records"))
	if got := gameIDs(history.Roms); len(got) != 1 || got[0] != second.ID {
		t.Fatalf("history after clearing a game's: %+v", history)
	}
}

func TestLibraryPages(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	quest, puzzle := player.addGame("Quest (USA).nes"), player.addGame("Puzzle (USA).nes")

	var consoles struct {
		Consoles []struct {
			Count    int    `json:"count"`
			Platform string `json:"platform"`
		} `json:"consoles"`
	}
	player.expectJSON(http.StatusOK, &consoles, player.get("/api/v1/pages/library/consoles"))
	if len(consoles.Consoles) != 1 || consoles.Consoles[0].Platform != "nes" || consoles.Consoles[0].Count != 2 {
		t.Fatalf("consoles: %+v", consoles)
	}
	// Everyone sees the one library
	other.expectJSON(http.StatusOK, &consoles, other.get("/api/v1/pages/library/consoles"))
	if len(consoles.Consoles) != 1 || consoles.Consoles[0].Count != 2 {
		t.Fatalf("the other player's consoles: %+v", consoles)
	}

	var list gameList
	player.expectJSON(http.StatusOK, &list, player.get("/api/v1/pages/library/platform?platform=nes&sort=name"))
	if got := gameIDs(list.Roms); len(got) != 2 || got[0] != puzzle.ID || got[1] != quest.ID || list.Title == "" {
		t.Fatalf("NES: %+v", list)
	}
	player.expect(http.StatusNotFound, player.get("/api/v1/pages/library/platform?platform=nothing"))
	player.expect(http.StatusBadRequest, player.get("/api/v1/pages/library/platform"))
	// Super Famicom's page, with none of its games left, leads to SNES's
	player.expectJSON(http.StatusOK, &list, player.get("/api/v1/pages/library/platform?platform=sfc"))
	if list.Redirect == nil || list.Redirect.Platform != "snes" {
		t.Fatalf("Super Famicom: %+v", list)
	}

	var page struct {
		Rom    game        `json:"rom"`
		States []saveState `json:"states"`
		Title  string      `json:"title"`
	}
	player.expectJSON(http.StatusOK, &page, player.get("/api/v1/pages/library/rom?platform=nes&file_name="+url.QueryEscape(quest.FileName)))
	if page.Rom.ID != quest.ID || page.Title == "" || page.States == nil {
		t.Fatalf("game page: %+v", page)
	}
	player.expect(http.StatusNotFound, player.get("/api/v1/pages/library/rom?platform=nes&file_name=Missing.nes"))
	// The same game's page for anyone else, with no saves of the player's
	other.expectJSON(http.StatusOK, &page, other.get("/api/v1/pages/library/rom?platform=nes&file_name="+url.QueryEscape(quest.FileName)))
	if page.Rom.ID != quest.ID {
		t.Fatalf("the other player's game page: %+v", page)
	}
}

func TestSearchAndPicks(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	other := api.register(t, "other")
	quest := player.addGame("Quest (USA).nes")
	player.addGame("Puzzle (USA).nes")

	var found gameList
	player.expectJSON(http.StatusOK, &found, player.get("/api/v1/roms/search?query=quest"))
	if got := gameIDs(found.Roms); len(got) != 1 || got[0] != quest.ID {
		t.Fatalf("search: %+v", found)
	}
	player.expectJSON(http.StatusOK, &found, player.get("/api/v1/roms/search?query=quest&platform=snes"))
	if len(found.Roms) != 0 {
		t.Fatalf("search on SNES: %+v", found)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/roms/search"))
	other.expectJSON(http.StatusOK, &found, other.get("/api/v1/roms/search?query=quest"))
	if len(found.Roms) != 1 {
		t.Fatalf("the other player's search: %+v", found)
	}

	// On this day: the games released on a day of the year
	player.expect(http.StatusOK, player.form(http.MethodPatch, "/api/v1/roms/"+quest.ID, url.Values{"gameReleaseDate": {"06/30/1987"}}))
	var picks []game
	player.expectJSON(http.StatusOK, &picks, player.get("/api/v1/roms/on_this_day?date=06-30"))
	if got := gameIDs(picks); len(got) != 1 || got[0] != quest.ID {
		t.Fatalf("on this day: %+v", picks)
	}
	player.expectJSON(http.StatusOK, &picks, player.get("/api/v1/roms/on_this_day?date=07-01"))
	if len(picks) != 0 {
		t.Fatalf("on another day: %+v", picks)
	}
	player.expect(http.StatusBadRequest, player.get("/api/v1/roms/on_this_day?date=June%2030"))
	other.expectJSON(http.StatusOK, &picks, other.get("/api/v1/roms/on_this_day?date=06-30"))
	if len(picks) != 1 {
		t.Fatalf("the other player's: %+v", picks)
	}

	// Without ratings from the game info database, no game is picked for these
	for _, path := range []string{"/api/v1/roms/rediscover", "/api/v1/roms/play_together"} {
		player.expectJSON(http.StatusOK, &picks, player.get(path))
		if len(picks) != 0 {
			t.Fatalf("%s: %+v", path, picks)
		}
	}
}

// Every route that needs an account refuses a request without one
func TestSignedOutIsRefused(t *testing.T) {
	api := newAPI(t)
	api.register(t, "player")
	stranger := api.browser(t)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/preference"}, {http.MethodPost, "/api/v1/preference"},
		{http.MethodPost, "/api/v1/preference/bioses"}, {http.MethodDelete, "/api/v1/preference/bioses"},
		{http.MethodGet, "/api/v1/states"}, {http.MethodPost, "/api/v1/states"}, {http.MethodDelete, "/api/v1/states/x"},
		{http.MethodGet, "/api/v1/game_saves"}, {http.MethodPost, "/api/v1/game_saves"},
		{http.MethodPost, "/api/v1/game_saves/x/restore"}, {http.MethodPost, "/api/v1/roms"},
		{http.MethodPatch, "/api/v1/roms/x"}, {http.MethodDelete, "/api/v1/roms/x"}, {http.MethodDelete, "/api/v1/roms"},
		{http.MethodPost, "/api/v1/roms/x/boxart"}, {http.MethodPost, "/api/v1/roms/x/thumbnail"},
		{http.MethodGet, "/api/v1/roms/x/content"}, {http.MethodGet, "/api/v1/roms/by_files"},
		{http.MethodGet, "/api/v1/launch_records"}, {http.MethodPost, "/api/v1/launch_records"},
		{http.MethodGet, "/api/v1/roms/search"}, {http.MethodGet, "/api/v1/roms/on_this_day"},
		{http.MethodGet, "/api/v1/pages/library/home"}, {http.MethodGet, "/api/v1/pages/library/consoles"},
		{http.MethodGet, "/api/v1/files/roms/nes/x.nes"},
	} {
		if answer := stranger.send(route.method, route.path, "", nil); answer.status != http.StatusUnauthorized {
			t.Errorf("%s %s answered %d", route.method, route.path, answer.status)
		}
	}
}

// Play history is each account's own, and stays whatever role the account is given
func TestPlayHistoryOutlastsARoleChange(t *testing.T) {
	api := newAPI(t)
	admin := api.register(t, "admin")
	added := admin.addGame("Quest (USA).nes")
	admin.expect(http.StatusOK, admin.form(http.MethodPost, "/api/v1/users",
		url.Values{"password": {"password-guest"}, "role": {"player"}, "username": {"guest"}}))
	guest := api.login(t, "guest")
	guest.expect(http.StatusOK, guest.form(http.MethodPost, "/api/v1/launch_records", url.Values{"core": {"fceumm"}, "rom": {added.ID}}))
	var history gameList
	for _, role := range []string{"contributor", "admin", "player"} {
		admin.expect(http.StatusOK, admin.form(http.MethodPatch, "/api/v1/users/"+guest.id, url.Values{"role": {role}}))
		for _, path := range []string{"/api/v1/launch_records", "/api/v1/pages/library/history"} {
			guest.expectJSON(http.StatusOK, &history, guest.get(path))
			if len(history.Roms) != 1 || history.Pagination.Total != 1 {
				t.Fatalf("%s as %s: %+v", path, role, history)
			}
		}
	}
	admin.expectJSON(http.StatusOK, &history, admin.get("/api/v1/launch_records"))
	if len(history.Roms) != 0 {
		t.Fatalf("the admin has the guest's history: %+v", history)
	}
}

// A search's matches are kept between its requests, but never past a change to the library
func TestSearchSeesChangesAtOnce(t *testing.T) {
	api := newAPI(t)
	player := api.register(t, "player")
	count := func() int {
		var counts struct {
			Games     int `json:"games"`
			Favorites int `json:"favorites"`
		}
		player.expectJSON(http.StatusOK, &counts, player.get("/api/v1/roms/search_counts?query=quest"))
		return counts.Games*10 + counts.Favorites
	}
	first := player.addGame("Quest (USA).nes")
	if got := count(); got != 10 {
		t.Fatalf("one game: %d", got)
	}
	if got := count(); got != 10 {
		t.Fatalf("asked again: %d", got)
	}
	second := player.addGame("Quest II (USA).nes")
	if got := count(); got != 20 {
		t.Fatalf("after adding one: %d", got)
	}
	player.expect(http.StatusOK, player.json(http.MethodPost, "/api/v1/favorites", map[string]string{"romId": second.ID}))
	if got := count(); got != 21 {
		t.Fatalf("after a favorite: %d", got)
	}
	player.expect(http.StatusOK, player.send(http.MethodDelete, "/api/v1/roms/"+first.ID, "", nil))
	if got := count(); got != 11 {
		t.Fatalf("after deleting one: %d", got)
	}
}
