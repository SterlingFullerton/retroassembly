// Package nasgames talks to the game service on the NAS, which runs games for players whose own device can't, and
// sends each player the picture and sound over the network as play together does. Players join through the app's
// invitations, as they would a game a person shares, so the app's part is small: start a game, list the ones
// running, and pass each joining player's offer and answer through.
package nasgames

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"retroassembly/server/internal/failure"
)

var (
	ErrOff         = failure.New(http.StatusServiceUnavailable, "Games on the NAS aren't set up")
	ErrUnavailable = failure.New(http.StatusBadGateway, "The NAS didn't answer")
)

// Game is a game running on the NAS, or one that ended in the last hour
type Game struct {
	Controls string `json:"controls"`
	Core     string `json:"core"`
	Ended    bool   `json:"ended"`
	ID       string `json:"id"`
	// Whose library the game is in, and its id there
	LibraryOwner string    `json:"libraryOwner"`
	Platform     string    `json:"platform"`
	Players      int       `json:"players"`
	Rom          string    `json:"rom"`
	Started      time.Time `json:"started"`
	StartedBy    string    `json:"startedBy"`
	Title        string    `json:"title"`
}

// Start is what the service needs to run a game: the emulator, and the game's file, relative to the games folder it
// shares with the app
type Start struct {
	Controls     string `json:"controls"`
	Core         string `json:"core"`
	File         string `json:"file"`
	LibraryOwner string `json:"libraryOwner"`
	Platform     string `json:"platform"`
	Rom          string `json:"rom"`
	// The player's latest save of the game, which it starts with
	Save      []byte `json:"save,omitempty"`
	StartedBy string `json:"startedBy"`
	Title     string `json:"title"`
}

// Client is the service at URL. A nil Client is one that isn't set up, and refuses everything
type Client struct {
	key  string
	base string
	http *http.Client
}

// New is a client for the service at base, or nil when either setting is missing
func New(base, key string) *Client {
	if base == "" || key == "" {
		return nil
	}
	return &Client{base: base, http: &http.Client{Timeout: 40 * time.Second}, key: key}
}

func (c *Client) call(ctx context.Context, method, path string, body, into any) error {
	if c == nil {
		return ErrOff
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.key)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		status := response.StatusCode
		if status == http.StatusUnauthorized || status >= 500 && status != http.StatusServiceUnavailable {
			status = http.StatusBadGateway
		}
		return failure.New(status, fmt.Sprintf("The NAS: %s", bytes.TrimSpace(message)))
	}
	if into == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(into)
}

// Start runs a game, and answers once it's ready for players
func (c *Client) Start(ctx context.Context, start Start) (Game, error) {
	var game Game
	err := c.call(ctx, http.MethodPost, "/games", start, &game)
	return game, err
}

// List is the games running
func (c *Client) List(ctx context.Context) ([]Game, error) {
	var games []Game
	err := c.call(ctx, http.MethodGet, "/games", nil, &games)
	return games, err
}

// ListAll is the games running, and those that ended in the last hour and whose last save hasn't been collected
func (c *Client) ListAll(ctx context.Context) ([]Game, error) {
	var games []Game
	err := c.call(ctx, http.MethodGet, "/games?all=1", nil, &games)
	return games, err
}

// Save is a game's own save, when it has one that hasn't been collected, and its checksum
func (c *Client) Save(ctx context.Context, id string) (content []byte, sha1 string, err error) {
	if c == nil {
		return nil, "", ErrOff
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/games/"+url.PathEscape(id)+"/save", nil)
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("Authorization", "Bearer "+c.key)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, "", ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, "", nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, "", failure.New(http.StatusBadGateway, "The NAS didn't give the game's save")
	}
	content, err = io.ReadAll(io.LimitReader(response.Body, 64<<20))
	return content, response.Header.Get("X-Save-Sha1"), err
}

// Collected tells the NAS the game's save with this checksum has been kept
func (c *Client) Collected(ctx context.Context, id, sha1 string) error {
	return c.call(ctx, http.MethodPost, "/games/"+url.PathEscape(id)+"/save/collected", map[string]string{"sha1": sha1}, nil)
}

// Cores is the emulators the NAS has, by the names the app gives them
func (c *Client) Cores(ctx context.Context) ([]string, error) {
	var cores []string
	err := c.call(ctx, http.MethodGet, "/cores", nil, &cores)
	return cores, err
}

// Stop ends a game
func (c *Client) Stop(ctx context.Context, id string) error {
	return c.call(ctx, http.MethodDelete, "/games/"+url.PathEscape(id), nil, nil)
}

// Offer keeps a place in a game for a new player, and is the offer their browser answers
func (c *Client) Offer(ctx context.Context, id string) (player int, offer string, err error) {
	var made struct {
		Offer  string `json:"offer"`
		Player int    `json:"player"`
	}
	err = c.call(ctx, http.MethodPost, "/games/"+url.PathEscape(id)+"/players", nil, &made)
	return made.Player, made.Offer, err
}

// Answer passes a player's answer to the game
func (c *Client) Answer(ctx context.Context, id string, player int, answer string) error {
	return c.call(ctx, http.MethodPost, fmt.Sprintf("/games/%s/players/%d/answer", url.PathEscape(id), player),
		map[string]string{"answer": answer}, nil)
}
