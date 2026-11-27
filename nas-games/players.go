package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// Players joining from the app's join page. The app's guest code answers an offer, so here the game makes one for each
// player, through the game service (serve.go): POST /players reserves a player's place and gives the offer, and POST
// /players/{player}/answer takes the browser's answer. The browser talks over the same two channels as with a player's
// own browser as the host: its controller on one, and the picture's shape on the other

// The picture's width over its height, as the core means it to be shown
var aspect = 4.0 / 3.0

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

var waitingFor = struct {
	sync.Mutex
	connections map[int]*webrtc.PeerConnection
}{connections: map[int]*webrtc.PeerConnection{}}

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
	var once sync.Once
	leave := func() { once.Do(func() { freeSlot(player) }) }
	connection, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		leave()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	connections.Store(connection, true)
	for _, track := range []webrtc.TrackLocal{videoTrack, audioTrack} {
		sender, err := connection.AddTrack(track)
		if err != nil {
			leave()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		go readFeedback(sender)
	}

	// The controller, sent as it is each time it changes: a lost message is made up for by the next
	none := uint16(0)
	input, err := connection.CreateDataChannel("input", negotiated(0, false, &none))
	check(err)
	input.OnMessage(func(message webrtc.DataChannelMessage) { pads[player].set(message.Data) })
	// Where the picture is in what's sent, and its shape: the whole of it, as the game draws it
	picture, err := connection.CreateDataChannel("picture", negotiated(1, true, nil))
	check(err)
	// The pause menu's requests, and the game's numbers for the performance overlay
	commands, err := connection.CreateDataChannel("commands", negotiated(2, true, nil))
	check(err)
	listenForCommands(commands)
	picture.OnOpen(func() {
		area, _ := json.Marshal(map[string]float64{"aspect": aspect, "height": 1, "left": 0, "top": 0, "width": 1})
		_ = picture.SendText(string(area))
	})

	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("player %d: %s", player+1, state)
		switch state {
		case webrtc.PeerConnectionStateConnected:
			wantKey.Store(true)
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			connections.Delete(connection)
			_ = connection.Close()
			leave()
		}
	})
	offer, err := connection.CreateOffer(nil)
	check(err)
	gathered := webrtc.GatheringCompletePromise(connection)
	check(connection.SetLocalDescription(offer))
	<-gathered

	waitingFor.Lock()
	waitingFor.connections[player] = connection
	waitingFor.Unlock()
	// A place nobody answers for is given back
	time.AfterFunc(answerWithin, func() {
		waitingFor.Lock()
		_, still := waitingFor.connections[player]
		delete(waitingFor.connections, player)
		waitingFor.Unlock()
		if still && connection.ConnectionState() != webrtc.PeerConnectionStateConnected {
			_ = connection.Close()
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
	connection := waitingFor.connections[player-1]
	delete(waitingFor.connections, player-1)
	waitingFor.Unlock()
	if connection == nil {
		http.Error(w, "that player's place has gone", http.StatusGone)
		return
	}
	if err := connection.SetRemoteDescription(answer); err != nil {
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

// readFeedback reads what a player's browser reports back about the picture; one whose picture broke asks for a whole
// one
func readFeedback(sender *webrtc.RTPSender) {
	for {
		packets, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, packet := range packets {
			switch packet.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				wantKey.Store(true)
			}
		}
	}
}
