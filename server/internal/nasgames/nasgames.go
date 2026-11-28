// Package nasgames talks to the game service on the NAS, which runs games for players whose own device can't, and
// sends each player the picture and sound over the network as play together does. Players join through the app's
// invitations, as they would a game a person shares, so the app's part is small: start a game, list the ones
// running, and pass each joining player's offer and answer through.
//
// What the service answers is passed on to players as failures with a code of their own (see failure.Coded), which the
// browser puts in the player's language: players are told about "the server", whatever the service's own words
package nasgames

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/failure"
)

// The codes of the failures players are told of, for the browser to put in their own language
const (
	CodeOff         = "server_off"
	CodeUnreachable = "server_unreachable"
	CodeRefused     = "server_refused"
	CodeFailed      = "server_failed"
	CodeFull        = "server_full"
	CodeNoEmulator  = "server_no_emulator"
	CodeNoGameFile  = "server_no_game_file"
	CodeNotFound    = "server_game_not_found"
	CodeGameFull    = "server_game_full"
	CodeLinked      = "server_linked_states"
	CodeBusy        = "server_busy"
	CodePlaceGone   = "server_place_gone"
	CodeBadSave     = "server_save_unreadable"
	CodeBadRequest  = "server_bad_request"
	CodeTimeout     = "server_start_timeout"
	CodeOutOfDate   = "server_out_of_date"
	CodeSaveTooBig  = "server_save_too_large"
)

var (
	ErrOff         = failure.Coded(http.StatusServiceUnavailable, CodeOff, "Games on the server aren't set up")
	ErrUnavailable = failure.Coded(http.StatusBadGateway, CodeUnreachable, "The server didn't answer")
	ErrOutOfDate   = failure.Coded(http.StatusBadGateway, CodeOutOfDate,
		"The server's game service is a different version from the app's")
	ErrSaveTooBig = failure.Coded(http.StatusRequestEntityTooLarge, CodeSaveTooBig,
		"The game's save is too large to play on the server")
)

// MaxSave is the largest save a game on the service starts with or is collected with. The service takes a start of up
// to 128 MiB of JSON, in which a save is base64, a third larger
const MaxSave = 64 << 20

// APIVersion is the version of the service's API this app speaks, which the service tells at GET /version. A service
// without it is taken to speak it too: one from before the version was told
const APIVersion = 1

// CapabilityLinked is a service that starts linked DS consoles and gives a friend's console its player's save
const CapabilityLinked = "linked"

// Version is what the service says of itself at GET /version. Known is false for a service that doesn't say
type Version struct {
	API          int      `json:"api"`
	Capabilities []string `json:"capabilities"`
	Known        bool     `json:"-"`
}

// Speaks is whether the service speaks the API this app does
func (v Version) Speaks() bool {
	return !v.Known || v.API == APIVersion
}

// Can is whether the service has a capability; one that doesn't say what it has is taken to have all this app uses
func (v Version) Can(capability string) bool {
	if !v.Known {
		return true
	}
	for _, have := range v.Capabilities {
		if have == capability {
			return true
		}
	}
	return false
}

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
	SaveType     string    `json:"saveType,omitempty"`
	Started      time.Time `json:"started"`
	StartedBy    string    `json:"startedBy"`
	Title        string    `json:"title"`
	// A console of a linked pair: 1 for the starter's, 2 for a friend's, and the other console's id
	Console    int    `json:"console,omitempty"`
	LinkedWith string `json:"linkedWith,omitempty"`
	// The emulator and kind of file the game's own save is kept as in the player's library, when not its own
	KeepAsCore     string `json:"keepAsCore,omitempty"`
	KeepAsFileType string `json:"keepAsFileType,omitempty"`
	// For a friend's console of a linked pair, the player whose save it was given, and whose it's kept as
	KeepFor *KeepFor `json:"keepFor,omitempty"`
}

// KeepFor is a player's copy of a game: whose library it's in, its id there, and the player
type KeepFor struct {
	LibraryOwner string `json:"libraryOwner"`
	Rom          string `json:"rom"`
	User         string `json:"user"`
}

// Start is what the service needs to run a game: the emulator, and the game's file, relative to the games folder it
// shares with the app
type Start struct {
	// The player's BIOS files for the console
	Bioses   []File `json:"bioses,omitempty"`
	Controls string `json:"controls"`
	Core     string `json:"core"`
	// Every disc of a game on several, in order, by its file in the games folder and its own name
	Discs []Disc `json:"discs,omitempty"`
	File  string `json:"file"`
	// The game's own file name
	FileName     string `json:"fileName"`
	LibraryOwner string `json:"libraryOwner"`
	// The player's settings for the emulator, as the browser gives it them
	Options  map[string]string `json:"options,omitempty"`
	Platform string            `json:"platform"`
	Rom      string            `json:"rom"`
	// The player's latest save of the game, which it starts with
	Save []byte `json:"save,omitempty"`
	// The kind of file the emulator keeps its save in, where it keeps it itself: a DS's .dsv or .sav
	SaveType  string `json:"saveType,omitempty"`
	StartedBy string `json:"startedBy"`
	Title     string `json:"title"`
	// The emulator and kind of file the game's own save is kept as in the player's library, when not its own
	KeepAsCore     string `json:"keepAsCore,omitempty"`
	KeepAsFileType string `json:"keepAsFileType,omitempty"`
}

// File is a file by its name, with its content
type File struct {
	Content []byte `json:"content"`
	Name    string `json:"name"`
}

// Disc is one disc of a game on several
type Disc struct {
	File     string `json:"file"`
	FileName string `json:"fileName"`
}

// Client is the service at URL. A nil Client is one that isn't set up, and refuses everything
type Client struct {
	key  string
	base string
	http *http.Client
	// The last trouble with the service that was logged, and when: logged again only once it changes, or after a while
	trouble struct {
		sync.Mutex
		kind string
		at   time.Time
	}
}

// How long a call waits for the service, unless it says otherwise
const callWithin = 40 * time.Second

// How long the service may take to start a game: a console that isn't ready within 30 s is stopped, and a linked pair
// is two consoles started one after the other. Giving a friend's console a save stops it (up to 5 s) and starts it
// again
const (
	startWithin       = 75 * time.Second
	startLinkedWithin = 100 * time.Second
	giveSaveWithin    = 60 * time.Second
)

// How often the same trouble with the service is logged again
const troubleLoggedEvery = 10 * time.Minute

// New is a client for the service at base, or nil when either setting is missing
func New(base, key string) *Client {
	if base == "" || key == "" {
		return nil
	}
	return &Client{base: strings.TrimSuffix(base, "/"), http: &http.Client{}, key: key}
}

// troubled logs trouble with the service: a kind not logged last, or the same once it's been a while
func (c *Client) troubled(kind string, detail any) {
	c.trouble.Lock()
	defer c.trouble.Unlock()
	if c.trouble.kind == kind && time.Since(c.trouble.at) < troubleLoggedEvery {
		return
	}
	c.trouble.kind, c.trouble.at = kind, time.Now()
	log.Printf("nas games: the game service %s: %v", kind, detail)
}

// fine notes that the service answered as it should, and logs it once after trouble
func (c *Client) fine() {
	c.trouble.Lock()
	defer c.trouble.Unlock()
	if c.trouble.kind != "" {
		log.Printf("nas games: the game service answers again")
		c.trouble.kind = ""
	}
}

// send makes a request of the service within `within`, and answers its response when it's a success. Anything else
// is closed, logged when it's the service's or the network's trouble, and answered as a failure players are told of
func (c *Client) send(ctx context.Context, within time.Duration, method, path string, body any) (*http.Response, error) {
	if c == nil {
		return nil, ErrOff
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	ctx, cancel := context.WithTimeout(ctx, within)
	request, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		cancel()
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+c.key)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		cancel()
		// The player's own browser going away isn't the service's trouble
		if !errors.Is(err, context.Canceled) {
			c.troubled("can't be reached", err)
		}
		return nil, ErrUnavailable
	}
	response.Body = &cancelOnClose{ReadCloser: response.Body, cancel: cancel}
	if response.StatusCode < 300 {
		c.fine()
		return response, nil
	}
	message, _ := io.ReadAll(io.LimitReader(response.Body, 512))
	response.Body.Close()
	return nil, c.refusal(method+" "+path, response.StatusCode, string(bytes.TrimSpace(message)))
}

// cancelOnClose is a response's body, whose request's time is up once it's read
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

// refusal is what players are told of the service answering a request with status and message. The service's own
// words name the NAS and are in English, so they're only logged, and only for trouble that isn't the player's doing
func (c *Client) refusal(request string, status int, message string) error {
	said := strings.ToLower(message)
	switch {
	case status == http.StatusUnauthorized:
		c.troubled("refuses the app's key", request)
		return failure.Coded(http.StatusBadGateway, CodeRefused, "The server refused the app")
	case status == http.StatusServiceUnavailable:
		c.fine()
		return failure.Coded(http.StatusServiceUnavailable, CodeFull, "The server is running as many games as it can")
	case status == http.StatusGatewayTimeout:
		c.troubled("couldn't start a game in time", fmt.Sprintf("%s: %s", request, message))
		return failure.Coded(http.StatusBadGateway, CodeTimeout, "The game didn't start on the server in time")
	case status >= 500:
		c.troubled(fmt.Sprintf("failed (%d)", status), fmt.Sprintf("%s: %s", request, message))
		return failure.Coded(http.StatusBadGateway, CodeFailed, "The server couldn't do that")
	}
	c.fine()
	switch {
	case status == http.StatusNotFound && strings.Contains(said, "emulator"):
		return failure.Coded(http.StatusNotFound, CodeNoEmulator, "The server doesn't have that emulator")
	case status == http.StatusNotFound && strings.Contains(said, "game file"):
		return failure.Coded(http.StatusNotFound, CodeNoGameFile, "The server can't find the game's file")
	case status == http.StatusNotFound:
		return failure.Coded(http.StatusNotFound, CodeNotFound, "No game to join by that code")
	case status == http.StatusConflict && strings.Contains(said, "four players"):
		return failure.Coded(http.StatusConflict, CodeGameFull, "That game has four players already")
	case status == http.StatusConflict && strings.Contains(said, "save states"):
		return failure.Coded(http.StatusConflict, CodeLinked, "A game with a friend has no save states")
	case status == http.StatusConflict:
		return failure.Coded(http.StatusConflict, CodeBusy, "The server can't do that now")
	case status == http.StatusGone:
		return failure.Coded(http.StatusGone, CodePlaceGone, "Ask to join again")
	case status == http.StatusBadRequest && strings.Contains(said, "save"):
		log.Printf("nas games: the game service couldn't use a save: %s: %s", request, message)
		return failure.Coded(http.StatusBadRequest, CodeBadSave, "The server couldn't read the game's save")
	}
	log.Printf("nas games: the game service refused %s (%d): %s", request, status, message)
	return failure.Coded(http.StatusBadRequest, CodeBadRequest, "The server couldn't do that")
}

func (c *Client) call(ctx context.Context, method, path string, body, into any) error {
	return c.callWithin(ctx, callWithin, method, path, body, into)
}

func (c *Client) callWithin(ctx context.Context, within time.Duration, method, path string, body, into any) error {
	response, err := c.send(ctx, within, method, path, body)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if into == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(into); err != nil {
		c.troubled("answers in a way this app doesn't read", fmt.Sprintf("%s %s: %v", method, path, err))
		return ErrOutOfDate
	}
	return nil
}

// Version is what the service says of itself; Known is false for one that doesn't say
func (c *Client) Version(ctx context.Context) (Version, error) {
	var version Version
	err := c.call(ctx, http.MethodGet, "/version", nil, &version)
	var refused *failure.Error
	if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
		return Version{}, nil
	}
	if err != nil {
		return Version{}, err
	}
	version.Known = true
	return version, nil
}

// Start runs a game, and answers once it's ready for players
func (c *Client) Start(ctx context.Context, start Start) (Game, error) {
	var game Game
	err := c.callWithin(ctx, startWithin, http.MethodPost, "/games", start, &game)
	return game, err
}

// StartLinked runs two consoles of a game linked as by a DS's local wireless, the starter's and a friend's, and
// answers with both, the starter's first, once they're ready for players
func (c *Client) StartLinked(ctx context.Context, start Start) ([]Game, error) {
	body := struct {
		Start
		Linked bool `json:"linked"`
	}{start, true}
	var answer json.RawMessage
	if err := c.callWithin(ctx, startLinkedWithin, http.MethodPost, "/games", body, &answer); err != nil {
		return nil, err
	}
	var games []Game
	if err := json.Unmarshal(answer, &games); err == nil && len(games) == 2 {
		return games, nil
	}
	// A service that doesn't link consoles starts one game of its own, which nobody would join: it's stopped
	c.troubled("doesn't start linked games", string(answer))
	var stray Game
	if json.Unmarshal(answer, &stray) == nil && stray.ID != "" {
		if err := c.Stop(context.WithoutCancel(ctx), stray.ID); err != nil {
			log.Printf("nas games: stopping %s, started unlinked: %v", stray.ID, err)
		}
	}
	for _, game := range games {
		if game.ID != "" {
			_ = c.Stop(context.WithoutCancel(ctx), game.ID)
		}
	}
	return nil, ErrOutOfDate
}

// GiveSave puts a player's own save into the friend's console of a linked pair, which starts its game again with it,
// and keeps that console's save as theirs from then on. A player with no save gives none, and keeps what it makes
func (c *Client) GiveSave(ctx context.Context, id string, save []byte, keepFor KeepFor) error {
	body := map[string]any{"keepFor": keepFor}
	if len(save) > 0 {
		body["save"] = save
	}
	return c.callWithin(ctx, giveSaveWithin, http.MethodPost, "/games/"+url.PathEscape(id)+"/save", body, nil)
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

// Save is a game's own save, when it has one that hasn't been collected, and its checksum. A save larger than MaxSave,
// or one whose content doesn't match its checksum, is refused rather than kept cut short
func (c *Client) Save(ctx context.Context, id string) (content []byte, sum string, err error) {
	response, err := c.send(ctx, callWithin, http.MethodGet, "/games/"+url.PathEscape(id)+"/save", nil)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil, "", nil
	}
	content, err = io.ReadAll(io.LimitReader(response.Body, MaxSave+1))
	if err != nil {
		return nil, "", ErrUnavailable
	}
	if len(content) > MaxSave {
		return nil, "", ErrSaveTooBig
	}
	sum = response.Header.Get("X-Save-Sha1")
	if digest := sha1.Sum(content); sum != hex.EncodeToString(digest[:]) {
		return nil, "", failure.Coded(http.StatusBadGateway, CodeFailed, "The server's save didn't arrive whole")
	}
	return content, sum, nil
}

// State is a save state of a game on the NAS
type State struct {
	Created time.Time `json:"created"`
	ID      string    `json:"id"`
	Size    int64     `json:"size"`
}

// States is a game's save states, newest first
func (c *Client) States(ctx context.Context, id string) ([]State, error) {
	var states []State
	err := c.call(ctx, http.MethodGet, "/games/"+url.PathEscape(id)+"/states", nil, &states)
	return states, err
}

// SaveState saves the game as it is now
func (c *Client) SaveState(ctx context.Context, id string) (State, error) {
	var state State
	err := c.call(ctx, http.MethodPost, "/games/"+url.PathEscape(id)+"/states", nil, &state)
	return state, err
}

// LoadState puts the game back as it was in a state
func (c *Client) LoadState(ctx context.Context, id, state string) error {
	return c.call(ctx, http.MethodPost, "/games/"+url.PathEscape(id)+"/states/"+url.PathEscape(state)+"/load", nil, nil)
}

// StatePicture is a state's picture, as a JPEG
func (c *Client) StatePicture(ctx context.Context, id, state string) ([]byte, error) {
	response, err := c.send(ctx, callWithin, http.MethodGet,
		"/games/"+url.PathEscape(id)+"/states/"+url.PathEscape(state)+"/picture", nil)
	var refused *failure.Error
	if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
		return nil, failure.Coded(http.StatusNotFound, "server_no_picture", "No picture")
	}
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	return io.ReadAll(io.LimitReader(response.Body, 8<<20))
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

// ForgetUser ends a deleted player's games on the server and removes the saves it keeps for them. A service from
// before it could do this answers 404, which is no failure: its games were ended one by one
func (c *Client) ForgetUser(ctx context.Context, user string) error {
	err := c.call(ctx, http.MethodDelete, "/users/"+url.PathEscape(user), nil, nil)
	var refused *failure.Error
	if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
		return nil
	}
	return err
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
