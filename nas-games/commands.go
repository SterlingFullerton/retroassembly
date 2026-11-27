package main

import (
	"encoding/json"
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
		switch command.Do {
		case "pause":
			paused.Store(true)
		case "resume":
			paused.Store(false)
		case "restart":
			restarting.Store(true)
			paused.Store(false)
		default:
			return
		}
		tellPlayers()
	})
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
