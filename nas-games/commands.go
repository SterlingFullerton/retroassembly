package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// What players' pause menus ask of the game, and what the game tells them back: on a third channel, alongside the
// controller's and the picture's, that only a game on the NAS has.
//
// A player sends {"do": "pause"}, {"do": "resume"} or {"do": "restart"}. Every second, each player is sent the game's
// numbers for their performance overlay, and whether it's paused

// The numbers over the last second, for players' overlays; the log has its own, over five
var live struct {
	sync.Mutex
	frames, encoded int
	run, encode     durations
}

var commandChannels sync.Map

// Who has the game paused: each player whose pause menu is open, by their channel, and the other console of a linked
// pair, for its own players. The game stands paused while anyone has it paused. A player's pause ends with their
// channel, so one who leaves with the menu open doesn't leave the game paused for the others, and no player's resume
// takes away another's pause
var pauses = struct {
	sync.Mutex
	players map[*webrtc.DataChannel]bool
	partner bool
}{players: map[*webrtc.DataChannel]bool{}}

// listenForCommands takes a player's pause menu's requests
func listenForCommands(channel *webrtc.DataChannel) {
	commandChannels.Store(channel, true)
	channel.OnClose(func() {
		commandChannels.Delete(channel)
		apply(channel, "resume")
	})
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		var command struct {
			Do string `json:"do"`
		}
		if json.Unmarshal(message.Data, &command) != nil {
			return
		}
		apply(channel, command.Do)
	})
}

// apply does what a player's pause menu asks, tells the players, and tells the other console of a linked pair when
// this one's players' pause began or ended, or the game restarted
func apply(channel *webrtc.DataChannel, do string) {
	pauses.Lock()
	before := len(pauses.players) > 0
	switch do {
	case "pause":
		pauses.players[channel] = true
	case "resume":
		delete(pauses.players, channel)
	case "restart":
		restarting.Store(true)
		clear(pauses.players)
		pauses.partner = false
	default:
		pauses.Unlock()
		return
	}
	after := len(pauses.players) > 0
	paused.Store(after || pauses.partner)
	pauses.Unlock()
	tellPlayers()
	if do == "restart" {
		tellPartner("restart")
	} else if after != before {
		tellPartner(pauseWord(after))
	}
}

func pauseWord(paused bool) string {
	if paused {
		return "pause"
	}
	return "resume"
}

// fromPartner does what the other console of a linked pair says: its players' pause began or ended, they restarted,
// or it has just started, with nobody's pause, and wants to know this one's
func fromPartner(said string) {
	pauses.Lock()
	switch said {
	case "pause", "resume":
		pauses.partner = said == "pause"
	case "restart":
		restarting.Store(true)
		clear(pauses.players)
		pauses.partner = false
	case "hello":
		pauses.partner = false
		defer tellPartner(pauseWord(len(pauses.players) > 0))
	default:
		pauses.Unlock()
		return
	}
	paused.Store(len(pauses.players) > 0 || pauses.partner)
	pauses.Unlock()
	tellPlayers()
}

// The other console of a linked pair (serve.go), which pauses, resumes and restarts with this one: paused alone, it
// would leave the other's wireless waiting on it, and restarted alone, the two would no longer match. Told over a
// socket of their own, PARTNER_SELF and PARTNER_PEER, which works while the game stands paused. A console started
// again, as a friend's is when they join, says hello, and the other tells it whether its players have it paused
var partner struct {
	conn *net.UnixConn
	peer *net.UnixAddr
}

// listenToPartner opens this console's end, if it has a partner, and does what the partner's players ask
func listenToPartner() {
	self, peer := os.Getenv("PARTNER_SELF"), os.Getenv("PARTNER_PEER")
	if self == "" || peer == "" {
		return
	}
	_ = os.Remove(self)
	conn, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: self, Net: "unixgram"})
	if err != nil {
		log.Printf("can't listen for the other console: %v", err)
		return
	}
	partner.conn, partner.peer = conn, &net.UnixAddr{Name: peer, Net: "unixgram"}
	go func() {
		buffer := make([]byte, 64)
		for {
			n, err := conn.Read(buffer)
			if err != nil {
				return
			}
			fromPartner(string(buffer[:n]))
		}
	}()
	tellPartner("hello")
}

// tellPartner tells the other console of a linked pair what this one's players did
func tellPartner(said string) {
	if partner.conn != nil {
		_, _ = partner.conn.WriteToUnix([]byte(said), partner.peer)
	}
}

// When a player last moved anything, as the game service asks: a game left running or paused with a player connected
// but nobody playing, such as a tab left open overnight, is stopped as an empty one is. Read from the controllers once
// a second; a stick has to move a fair way to count, so one resting a little off centre doesn't
var input = struct {
	sync.Mutex
	last time.Time
	seen [len(pads)]padReading
}{last: time.Now()}

type padReading struct {
	buttons            uint16
	axes               [4]int16
	pointerX, pointerY int16
	pointerDown        bool
}

func noteInput() {
	moved := false
	for index := range pads {
		p := &pads[index]
		p.mu.Lock()
		now := padReading{buttons: p.buttons, axes: p.axes, pointerX: p.pointerX, pointerY: p.pointerY, pointerDown: p.pointerDown}
		p.mu.Unlock()
		before := input.seen[index]
		moved = moved || now.buttons != before.buttons || now.pointerDown != before.pointerDown ||
			now.pointerDown && (now.pointerX != before.pointerX || now.pointerY != before.pointerY)
		for axis := range now.axes {
			moved = moved || abs(int(now.axes[axis])-int(before.axes[axis])) > 8192
		}
		input.seen[index] = now
	}
	if moved {
		input.last = time.Now()
	}
}

func abs(value int) int { return max(value, -value) }

// GET /activity is what the game service checks to stop a game nobody is playing: how many players are in it, whether
// it stands paused, and for how many seconds nobody has moved anything. On the game's own server, beside /status
func init() {
	http.HandleFunc("GET /activity", func(w http.ResponseWriter, _ *http.Request) {
		input.Lock()
		quiet := time.Since(input.last)
		input.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(activity{InputIdle: int(quiet.Seconds()), Paused: paused.Load(), Players: int(players.Load())})
	})
}

type activity struct {
	InputIdle int  `json:"inputIdle"`
	Paused    bool `json:"paused"`
	Players   int  `json:"players"`
}

type numbers struct {
	// Frames the game ran in the last second
	FPS float64 `json:"fps"`
	// The time a frame took to run, and to encode, in milliseconds: on average, and at most
	RunAvg    float64 `json:"runAvg"`
	RunMax    float64 `json:"runMax"`
	EncodeAvg float64 `json:"encodeAvg"`
	Paused    bool    `json:"paused"`
	Players   int32   `json:"players"`
}

var lastNumbers struct {
	sync.Mutex
	numbers
}

func tellPlayers() {
	lastNumbers.Lock()
	lastNumbers.Paused = paused.Load()
	lastNumbers.Players = players.Load()
	text, _ := json.Marshal(lastNumbers.numbers)
	lastNumbers.Unlock()
	commandChannels.Range(func(key, _ any) bool {
		if channel, ok := key.(*webrtc.DataChannel); ok && channel.ReadyState() == webrtc.DataChannelStateOpen {
			_ = channel.SendText(string(text))
		}
		return true
	})
}

// tellPlayersEverySecond sends each player the game's numbers once a second
func tellPlayersEverySecond() {
	for range time.Tick(time.Second) {
		live.Lock()
		current := numbers{FPS: float64(live.frames), RunMax: ms(live.run.max)}
		if live.frames > 0 {
			current.RunAvg = ms(live.run.total) / float64(live.frames)
		}
		if live.encoded > 0 {
			current.EncodeAvg = ms(live.encode.total) / float64(live.encoded)
		}
		live.frames, live.encoded, live.run, live.encode = 0, 0, durations{}, durations{}
		live.Unlock()
		input.Lock()
		noteInput()
		input.Unlock()
		lastNumbers.Lock()
		lastNumbers.numbers = current
		lastNumbers.Unlock()
		tellPlayers()
	}
}
