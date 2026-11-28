package main

import (
	"encoding/json"
	"log"
	"net"
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

// listenForCommands takes a player's pause menu's requests
func listenForCommands(channel *webrtc.DataChannel) {
	commandChannels.Store(channel, true)
	channel.OnClose(func() { commandChannels.Delete(channel) })
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		var command struct {
			Do string `json:"do"`
		}
		if json.Unmarshal(message.Data, &command) != nil {
			return
		}
		if apply(command.Do) {
			tellPartner(command.Do)
		}
	})
}

// apply does what a pause menu asks, and tells the players: whether it was something to do
func apply(do string) bool {
	switch do {
	case "pause":
		paused.Store(true)
	case "resume":
		paused.Store(false)
	case "restart":
		restarting.Store(true)
		paused.Store(false)
	default:
		return false
	}
	tellPlayers()
	return true
}

// The other console of a linked pair (serve.go), which pauses, resumes and restarts with this one: paused alone, it
// would leave the other's wireless waiting on it, and restarted alone, the two would no longer match. Told over a
// socket of their own, PARTNER_SELF and PARTNER_PEER, which works while the game stands paused
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
			// Done here and not passed back: the partner has done it already
			apply(string(buffer[:n]))
		}
	}()
}

// tellPartner asks the other console of a linked pair to do what this one's players asked
func tellPartner(do string) {
	if partner.conn != nil {
		_, _ = partner.conn.WriteToUnix([]byte(do), partner.peer)
	}
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
		lastNumbers.Lock()
		lastNumbers.numbers = current
		lastNumbers.Unlock()
		tellPlayers()
	}
}
