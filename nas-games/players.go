package main

import (
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// Players joining from the app's join page. The app's guest code answers an offer, so here the game makes one for each
// player, through the game service (serve.go): POST /players reserves a player's place and gives the offer, and POST
// /players/{player}/answer takes the browser's answer. The browser talks over the same two channels as with a player's
// own browser as the host: its controller on one, and the picture's shape on the other

// The picture's width over its height, as the core means it to be shown. It can change as the game runs (a game
// turned upright, a core that changes its picture's shape), and players are told each time
var aspectBits atomic.Uint64

func init() { setAspect(4.0 / 3.0) }

func getAspect() float64      { return math.Float64frombits(aspectBits.Load()) }
func setAspect(value float64) { aspectBits.Store(math.Float64bits(value)) }

// Every player's picture channel, to tell them when the picture's shape changes
var pictureChannels sync.Map

func pictureArea() string {
	area, _ := json.Marshal(map[string]float64{"aspect": getAspect(), "height": 1, "left": 0, "top": 0, "width": 1})
	return string(area)
}

// tellPictureShape tells every player the picture's shape, which has changed
func tellPictureShape() {
	area := pictureArea()
	pictureChannels.Range(func(key, _ any) bool {
		if channel, ok := key.(*webrtc.DataChannel); ok && channel.ReadyState() == webrtc.DataChannelStateOpen {
			_ = channel.SendText(area)
		}
		return true
	})
}

// Every player's connection, so that a game asked to end can close them and players are told at once, rather than
// when their browser gives up waiting
var connections sync.Map

func closeConnections() {
	connections.Range(func(key, _ any) bool {
		if connection, ok := key.(*webrtc.PeerConnection); ok {
			_ = connection.Close()
		}
		return true
	})
}

// How long a player's place is held for their answer
const answerWithin = 30 * time.Second

// A player's place held for their answer: their connection, and how to give the place back
type waitingPlayer struct {
	connection *webrtc.PeerConnection
	leave      func()
}

var waitingFor = struct {
	sync.Mutex
	connections map[int]waitingPlayer
}{connections: map[int]waitingPlayer{}}

func negotiated(id uint16, ordered bool, retransmits *uint16) *webrtc.DataChannelInit {
	yes := true
	return &webrtc.DataChannelInit{ID: &id, MaxRetransmits: retransmits, Negotiated: &yes, Ordered: &ordered}
}

func handleNewPlayer(w http.ResponseWriter, _ *http.Request) {
	player := takeSlot()
	if player < 0 {
		http.Error(w, "four players already", http.StatusConflict)
		return
	}
	// The player's number can move down (see connectSlot and freeSlot); `player` stays the place their answer is kept
	// under
	var slot atomic.Int32
	slot.Store(int32(player))
	var connection *webrtc.PeerConnection
	var once sync.Once
	leave := func() {
		once.Do(func() {
			if connection != nil {
				connections.Delete(connection)
				forgetEstimate(connection)
				_ = connection.Close()
			}
			freeSlot(&slot)
		})
	}
	refuse := func(err error) {
		leave()
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
	connection, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		refuse(err)
		return
	}
	connections.Store(connection, true)
	for _, track := range []webrtc.TrackLocal{videoTrack, audioTrack} {
		sender, err := connection.AddTrack(track)
		if err != nil {
			refuse(err)
			return
		}
		go readFeedback(sender, connection, track == videoTrack)
	}

	// The controller, sent as it is each time it changes: a lost message is made up for by the next
	none := uint16(0)
	input, err := connection.CreateDataChannel("input", negotiated(0, false, &none))
	if err != nil {
		refuse(err)
		return
	}
	input.OnMessage(func(message webrtc.DataChannelMessage) { pads[slot.Load()].set(message.Data) })
	// Where the picture is in what's sent, and its shape: the whole of it, as the game draws it
	picture, err := connection.CreateDataChannel("picture", negotiated(1, true, nil))
	if err != nil {
		refuse(err)
		return
	}
	// The pause menu's requests, and the game's numbers for the performance overlay
	commands, err := connection.CreateDataChannel("commands", negotiated(2, true, nil))
	if err != nil {
		refuse(err)
		return
	}
	listenForCommands(commands)
	picture.OnOpen(func() {
		pictureChannels.Store(picture, true)
		_ = picture.SendText(pictureArea())
	})
	picture.OnClose(func() { pictureChannels.Delete(picture) })

	var connected atomic.Bool
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("player %d: %s", slot.Load()+1, state)
		switch state {
		case webrtc.PeerConnectionStateConnected:
			connected.Store(true)
			wantKey.Store(true)
			connectSlot(&slot)
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			// Not on disconnected: a phone changing networks, or a browser in the background for a moment, comes back
			// on its own. One that doesn't is failed after a while
			leave()
		}
	})
	offer, err := connection.CreateOffer(nil)
	if err != nil {
		refuse(err)
		return
	}
	gathered := webrtc.GatheringCompletePromise(connection)
	if err := connection.SetLocalDescription(offer); err != nil {
		refuse(err)
		return
	}
	<-gathered

	waitingFor.Lock()
	waitingFor.connections[player] = waitingPlayer{connection: connection, leave: leave}
	waitingFor.Unlock()
	// A place nobody answers for, or whose player never connects, is given back. Only this player's: the same place
	// may be another player's by now, given back and taken again
	time.AfterFunc(answerWithin, func() {
		waitingFor.Lock()
		if waiting, ok := waitingFor.connections[player]; ok && waiting.connection == connection {
			delete(waitingFor.connections, player)
		}
		waitingFor.Unlock()
		if !connected.Load() {
			leave()
		}
	})

	// As the app's browsers swap them: the description as JSON text
	description, _ := json.Marshal(connection.LocalDescription())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"player": player + 1, "offer": string(description)})
}

func handlePlayerAnswer(w http.ResponseWriter, r *http.Request) {
	player, err := strconv.Atoi(r.PathValue("player"))
	if err != nil || player < 1 || player > 4 {
		http.Error(w, "no such player", http.StatusNotFound)
		return
	}
	var body struct {
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var answer webrtc.SessionDescription
	if err := json.Unmarshal([]byte(body.Answer), &answer); err != nil || answer.Type != webrtc.SDPTypeAnswer {
		http.Error(w, "not an answer", http.StatusBadRequest)
		return
	}
	waitingFor.Lock()
	waiting, ok := waitingFor.connections[player-1]
	delete(waitingFor.connections, player-1)
	waitingFor.Unlock()
	if !ok {
		http.Error(w, "that player's place has gone", http.StatusGone)
		return
	}
	if err := waiting.connection.SetRemoteDescription(answer); err != nil {
		// The place is given back at once: the player can't connect with it
		waiting.leave()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleStatus is what the game service checks: how many players are in the game
func handleStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"players": players.Load()})
}

// ---- What the picture may take, from what players' browsers report ----
//
// Each player's browser reports, about once a second, the share of the picture's packets it lost. As the loss-based
// half of WebRTC's own congestion control (GCC) does: a player losing more than a tenth has their rate cut by half
// that share, and one losing almost nothing has it raised a little, up to the most. The picture is encoded for the
// player with the lowest rate: one picture goes to all of them

const (
	leastKilobits = 800
	// Rates are kept to steps of this, so the encoder isn't told of every small change
	kilobitStep = 100
)

// Each connected player's rate, in kilobits a second, by their connection
var estimates sync.Map

// nextEstimate is a player's rate after a report that they lost `lost` of the packets, 0 to 1
func nextEstimate(rate int, lost float64) int {
	next := float64(rate)
	switch {
	case lost > 0.1:
		next *= 1 - lost/2
	case lost < 0.02:
		next *= 1.08
	}
	// At least a step each way, so the rate doesn't stay put for being rounded back to it
	stepped := int(math.Round(next/kilobitStep)) * kilobitStep
	if lost > 0.1 {
		stepped = min(stepped, rate-kilobitStep)
	} else if lost < 0.02 {
		stepped = max(stepped, rate+kilobitStep)
	}
	return min(kilobits, max(leastKilobits, stepped))
}

// lowestEstimate is the rate the picture is encoded at: the lowest player's
func lowestEstimate() int {
	lowest := kilobits
	estimates.Range(func(_, value any) bool {
		lowest = min(lowest, int(value.(*atomic.Int32).Load()))
		return true
	})
	return lowest
}

func forgetEstimate(connection *webrtc.PeerConnection) { estimates.Delete(connection) }

// readFeedback reads what a player's browser reports back: one whose picture broke asks for a whole one, and the
// picture's reports say how much of it was lost
func readFeedback(sender *webrtc.RTPSender, connection *webrtc.PeerConnection, video bool) {
	var ssrc webrtc.SSRC
	if encodings := sender.GetParameters().Encodings; len(encodings) > 0 {
		ssrc = encodings[0].SSRC
	}
	for {
		packets, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, packet := range packets {
			switch packet := packet.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				wantKey.Store(true)
			case *rtcp.ReceiverReport:
				if !video || connection.ConnectionState() != webrtc.PeerConnectionStateConnected {
					continue
				}
				for _, report := range packet.Reports {
					if webrtc.SSRC(report.SSRC) != ssrc {
						continue
					}
					value, _ := estimates.LoadOrStore(connection, newEstimate())
					rate := value.(*atomic.Int32)
					rate.Store(int32(nextEstimate(int(rate.Load()), float64(report.FractionLost)/256)))
					// A player who left as this came in isn't counted
					if connection.ConnectionState() != webrtc.PeerConnectionStateConnected {
						forgetEstimate(connection)
					}
				}
			}
		}
	}
}

func newEstimate() *atomic.Int32 {
	var rate atomic.Int32
	rate.Store(kilobits)
	return &rate
}
