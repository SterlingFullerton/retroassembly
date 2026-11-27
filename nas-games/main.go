// One game run on the NAS, and the game service that starts them (serve.go).
//
// Runs one game with a libretro core on the NAS (frontend.c), and sends its picture and sound to every browser
// connected over WebRTC, each frame the moment it's made. Each browser's controller is read straight into the core
// every frame. Up to four players.
package main

/*
#cgo CFLAGS: -O2 -Wall -Wno-unused-function
#cgo LDFLAGS: -ldl -lEGL -lGL -lyuv -lopus -lspeexdsp -lx264 -lm
#include <stdlib.h>
#include "frontend.h"
*/
import "C"

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/pion/ice/v4"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

//go:embed index.html
var page []byte

const (
	padStateSize = 7
	kilobits     = 6000
)

func init() {
	// The core and its OpenGL context live on one thread: this one
	runtime.LockOSThread()
}

var (
	videoTrack *webrtc.TrackLocalStaticSample
	audioTrack *webrtc.TrackLocalStaticSample
	api        *webrtc.API
	players    atomic.Int32
	wantKey    atomic.Bool
	stopping   atomic.Bool
	paused     atomic.Bool
	restarting atomic.Bool
	pads       [4]pad
)

// One player's controller, as the core reads it: RetroPad buttons as bits, and the two sticks
type pad struct {
	mu      sync.Mutex
	buttons uint16
	axes    [4]int16
}

// Standard gamepad buttons, in the order the browser numbers them, as RetroPad ids
var retroPadID = [16]uint{0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7}

// set takes a controller as play together sends it: three bytes of buttons, a bit each, then a signed byte per axis
func (p *pad) set(state []byte) {
	if len(state) != padStateSize {
		return
	}
	var pressed uint16
	for button := range 16 {
		if state[button/8]&(1<<(button%8)) != 0 {
			pressed |= 1 << retroPadID[button]
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.buttons = pressed
	for axis := range 4 {
		p.axes[axis] = int16(math.Round(float64(int8(state[3+axis])) / 127 * 32767))
	}
}

func (p *pad) clear() { p.set(make([]byte, padStateSize)) }

type stats struct {
	sync.Mutex
	frames, dropped, keyframes, soundPackets int
	bytes                                    int
	run, encode                              durations
	started                                  time.Time
}

type durations struct{ total, max time.Duration }

func (d *durations) add(value time.Duration) {
	d.total += value
	d.max = max(d.max, value)
}

var counters stats

func main() {
	if len(os.Args) > 1 && os.Args[1] == "serve" {
		serve()
		return
	}
	corePath := envOr("CORE_PATH", "/cores/"+envOr("CORE", "mupen64plus_next")+"_libretro.so")
	game := envOr("GAME", "/roms/n64/41588bc8c1ba62f0.z64")
	saveDir := envOr("SAVE_DIR", "/config/saves")
	_ = os.MkdirAll(saveDir, 0o755)
	for _, pair := range strings.Split(os.Getenv("CORE_OPTIONS"), ";") {
		if key, value, ok := strings.Cut(pair, "="); ok {
			setOption(key, value)
		}
	}

	if code := load(corePath, game, envOr("SYSTEM_DIR", "/system"), saveDir); code != 0 {
		log.Fatalf("loading %s with %s failed: %d", game, corePath, code)
	}
	fps := float64(C.fe_fps())
	rate := float64(C.fe_sample_rate())
	aspect = float64(C.fe_aspect())
	savePath := filepath.Join(saveDir, strings.TrimSuffix(filepath.Base(game), filepath.Ext(game))+".srm")
	restoreSave(savePath)

	// Asked to end: the game's own save is kept, then it ends
	ending := make(chan os.Signal, 1)
	signal.Notify(ending, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-ending
		stopping.Store(true)
	}()

	startNetwork()
	period := time.Duration(float64(time.Second) / fps)
	pictures := make(chan picture, 2)
	sounds := make(chan []int16, 16)
	go encodePictures(pictures, fps, period)
	go encodeSound(sounds, rate)
	go report(period)
	go tellPlayersEverySecond()
	run(period, pictures, sounds, savePath)
}

func load(corePath, game, systemDir, saveDir string) int {
	values := []*C.char{C.CString(corePath), C.CString(game), C.CString(systemDir), C.CString(saveDir)}
	defer func() {
		for _, value := range values {
			C.free(unsafe.Pointer(value))
		}
	}()
	return int(C.fe_load(values[0], values[1], values[2], values[3]))
}

func setOption(key, value string) {
	k, v := C.CString(key), C.CString(value)
	C.fe_set_option(k, v)
	C.free(unsafe.Pointer(k))
	C.free(unsafe.Pointer(v))
}

type picture struct {
	data          []byte
	width, height int
}

// run plays the game a frame at a time, at its own frame rate, and hands each new picture and its sound on at once
func run(period time.Duration, pictures chan<- picture, sounds chan<- []int16, savePath string) {
	buffer := make([]byte, 4096*2048*3/2)
	sound := make([]int16, 48000*2)
	next := time.Now()
	lastSave := time.Now()
	var saved []byte
	for {
		for port := range pads {
			p := &pads[port]
			p.mu.Lock()
			C.fe_set_pad(C.int(port), C.uint16_t(p.buttons), C.int16_t(p.axes[0]), C.int16_t(p.axes[1]),
				C.int16_t(p.axes[2]), C.int16_t(p.axes[3]))
			p.mu.Unlock()
		}
		if restarting.Swap(false) {
			C.fe_reset()
		}
		if paused.Load() {
			// Paused: the game stands still, and nothing new is sent. The picture players see stays as it was
			next = next.Add(period)
			time.Sleep(max(0, time.Until(next)))
			if stopping.Load() {
				keepSave(savePath, saved)
				closeConnections()
				time.Sleep(300 * time.Millisecond)
				C.fe_unload()
				os.Exit(0)
			}
			continue
		}
		started := time.Now()
		C.fe_run()
		var width, height C.int
		size := int(C.fe_take_frame((*C.uint8_t)(unsafe.Pointer(&buffer[0])), C.int(len(buffer)), &width, &height))
		took := time.Since(started)
		counters.Lock()
		counters.frames++
		counters.run.add(took)
		counters.Unlock()
		live.Lock()
		live.frames++
		live.run.add(took)
		live.Unlock()
		if size > 0 {
			copied := make([]byte, size)
			copy(copied, buffer[:size])
			select {
			case pictures <- picture{copied, int(width), int(height)}:
			default:
				counters.Lock()
				counters.dropped++
				counters.Unlock()
			}
		}
		if frames := int(C.fe_take_sound((*C.int16_t)(unsafe.Pointer(&sound[0])), C.int(len(sound)/2))); frames > 0 {
			sounds <- slices.Clone(sound[:frames*2])
		}
		if stopping.Load() {
			keepSave(savePath, saved)
			closeConnections()
			// Long enough for the goodbyes to leave
			time.Sleep(300 * time.Millisecond)
			C.fe_unload()
			log.Printf("ended")
			os.Exit(0)
		}
		if time.Since(lastSave) > 10*time.Second {
			lastSave = time.Now()
			saved = keepSave(savePath, saved)
		}
		next = next.Add(period)
		if wait := time.Until(next); wait > 0 {
			time.Sleep(wait)
		} else if wait < -4*period {
			// Far behind, after a hitch: start counting again from now rather than racing to catch up
			next = time.Now()
		}
	}
}

func saveRAM() []byte {
	size := int(C.fe_save_size())
	data := C.fe_save_data()
	if size <= 0 || data == nil {
		return nil
	}
	return C.GoBytes(data, C.int(size))
}

func restoreSave(path string) {
	contents, err := os.ReadFile(path)
	size := int(C.fe_save_size())
	data := C.fe_save_data()
	if err != nil || size <= 0 || data == nil {
		return
	}
	copy(unsafe.Slice((*byte)(data), size), contents)
	log.Printf("save restored from %s", path)
}

// keepSave writes the game's own save when it has changed since `last`, and returns it
func keepSave(path string, last []byte) []byte {
	current := saveRAM()
	if current == nil || bytes.Equal(current, last) {
		return last
	}
	if last != nil || anyNonZero(current) {
		if err := os.WriteFile(path, current, 0o644); err == nil {
			log.Printf("save kept: %s", path)
		}
	}
	return current
}

func anyNonZero(data []byte) bool {
	return slices.ContainsFunc(data, func(b byte) bool { return b != 0 })
}

// encodePictures encodes each picture as H.264 the moment it arrives and sends it to every player
func encodePictures(pictures <-chan picture, fps float64, period time.Duration) {
	var encoder *C.video_encoder
	width, height := 0, 0
	var pts int64
	for p := range pictures {
		if encoder == nil || p.width != width || p.height != height {
			if encoder != nil {
				C.ve_free(encoder)
			}
			width, height = p.width, p.height
			encoder = C.ve_new(C.int(width), C.int(height), C.double(fps), C.int(kilobits))
			if encoder == nil {
				log.Fatalf("no encoder for %dx%d", width, height)
			}
			log.Printf("encoding %dx%d at %.2f fps", width, height, fps)
			wantKey.Store(true)
		}
		keyframe := 0
		if wantKey.Swap(false) {
			keyframe = 1
		}
		started := time.Now()
		var out *C.uint8_t
		size := int(C.ve_encode(encoder, (*C.uint8_t)(unsafe.Pointer(&p.data[0])), C.int(keyframe), C.int64_t(pts), &out))
		pts++
		took := time.Since(started)
		counters.Lock()
		counters.encode.add(took)
		counters.keyframes += keyframe
		counters.Unlock()
		live.Lock()
		live.encoded++
		live.encode.add(took)
		live.Unlock()
		if size > 0 {
			data := C.GoBytes(unsafe.Pointer(out), C.int(size))
			counters.Lock()
			counters.bytes += size
			counters.Unlock()
			_ = videoTrack.WriteSample(media.Sample{Data: data, Duration: period})
		}
	}
}

// encodeSound turns the core's sound into 10 ms Opus packets as it comes. Cores make sound in bursts, some of several
// frames' worth at once; sent as made, the bursts look to a browser like an unsteady network, and it buffers a fifth of
// a second against them. So the packets go out on a steady 10 ms clock instead, with a few kept in hand
func encodeSound(sounds <-chan []int16, rate float64) {
	encoder := C.se_new(C.double(rate))
	const capacity = 1500
	out := make([]byte, capacity*64)
	sizes := make([]C.int, 64)
	queue := make(chan []byte, 64)
	go paceSound(queue)
	for samples := range sounds {
		count := int(C.se_push(encoder, (*C.int16_t)(unsafe.Pointer(&samples[0])), C.int(len(samples)/2),
			(*C.uint8_t)(unsafe.Pointer(&out[0])), capacity, &sizes[0], 64))
		for index := range count {
			select {
			case queue <- slices.Clone(out[index*capacity : index*capacity+int(sizes[index])]):
			default:
			}
		}
		counters.Lock()
		counters.soundPackets += count
		counters.Unlock()
	}
}

// How many packets may wait to be sent, 10 ms each: more than this and the oldest go, so sound never falls behind
const soundInHand = 4

func paceSound(queue chan []byte) {
	ticker := time.NewTicker(10 * time.Millisecond)
	// Ticks with nothing to send. The next packet's timestamp moves on past them, so a browser hears a short gap where
	// the sound ran dry. Without that, every later packet looks late to it, and it buffers more and more to make up
	skipped := 0
	for range ticker.C {
		for len(queue) > soundInHand {
			<-queue
		}
		select {
		case packet := <-queue:
			_ = audioTrack.WriteSample(media.Sample{Data: packet, Duration: 10 * time.Millisecond,
				PrevDroppedPackets: uint16(min(skipped, 100))})
			skipped = 0
		default:
			skipped++
		}
	}
}

func report(period time.Duration) {
	for range time.Tick(5 * time.Second) {
		counters.Lock()
		if counters.frames > 0 {
			seconds := 5.0
			log.Printf("game %.1f fps (aim %.2f), run %.1f ms avg %.1f max, encode %.1f ms avg %.1f max, %.2f Mbps, "+
				"dropped %d, keyframes %d, sound packets %d, players %d",
				float64(counters.frames)/seconds, float64(time.Second)/float64(period),
				ms(counters.run.total)/float64(counters.frames), ms(counters.run.max),
				ms(counters.encode.total)/float64(max(1, counters.frames-counters.dropped)), ms(counters.encode.max),
				float64(counters.bytes*8)/seconds/1e6, counters.dropped, counters.keyframes, counters.soundPackets,
				players.Load())
		}
		counters.frames, counters.dropped, counters.keyframes, counters.soundPackets, counters.bytes = 0, 0, 0, 0, 0
		counters.run, counters.encode = durations{}, durations{}
		counters.Unlock()
	}
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

// ---- Network: the test page, WebRTC, and player slots ----

func startNetwork() {
	var err error
	videoTrack, err = webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"},
		"video", "nas-picture")
	check(err)
	audioTrack, err = webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"audio", "nas-sound")
	check(err)

	settings := webrtc.SettingEngine{}
	httpAddress := envOr("HTTP_ADDRESS", ":8097")
	mediaPort := envOr("MEDIA_PORT", "47900")
	var addresses []string
	if names := os.Getenv("ICE_INTERFACES"); names != "" {
		// On the NAS's own network: the game's port on the named networks only (the home network's and Tailscale's), so
		// Docker's own networks are never offered to players
		allowed := map[string]bool{}
		for _, name := range strings.Split(names, ",") {
			allowed[strings.TrimSpace(name)] = true
		}
		port, err := strconv.Atoi(mediaPort)
		check(err)
		mux, err := ice.NewMultiUDPMuxFromPort(port,
			ice.UDPMuxFromPortWithInterfaceFilter(func(name string) bool { return allowed[name] }),
			ice.UDPMuxFromPortWithNetworks(ice.NetworkTypeUDP4))
		check(err)
		settings.SetICEUDPMux(mux)
		addresses = []string{names}
	} else {
		settings.SetICEUDPMux(webrtc.NewICEUDPMux(nil, mustListenUDP(":"+mediaPort)))
		// In a container of its own, its address is useless outside it; these are where the NAS is reached
		addresses = strings.Split(envOr("REACHABLE_AT", "192.168.2.16,100.64.0.1"), ",")
		settings.SetNAT1To1IPs(addresses, webrtc.ICECandidateTypeHost)
	}
	settings.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	api = webrtc.NewAPI(webrtc.WithSettingEngine(settings))

	http.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(page)
	})
	http.HandleFunc("/offer", handleOffer)
	http.HandleFunc("POST /players", handleNewPlayer)
	http.HandleFunc("POST /players/{player}/answer", handlePlayerAnswer)
	http.HandleFunc("GET /status", handleStatus)
	log.Printf("listening on %s, media on udp %s, reachable at %v", httpAddress, mediaPort, addresses)
	go func() { check(http.ListenAndServe(httpAddress, nil)) }()
}

var slots struct {
	sync.Mutex
	taken [4]bool
}

// takeSlot gives a new player the lowest free player number, from 0, or -1 when all four are taken
func takeSlot() int {
	slots.Lock()
	defer slots.Unlock()
	for index, taken := range slots.taken {
		if !taken {
			slots.taken[index] = true
			players.Add(1)
			return index
		}
	}
	return -1
}

func freeSlot(index int) {
	slots.Lock()
	defer slots.Unlock()
	if slots.taken[index] {
		slots.taken[index] = false
		players.Add(-1)
		pads[index].clear()
	}
}

func handleOffer(w http.ResponseWriter, r *http.Request) {
	var offer webrtc.SessionDescription
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&offer); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
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
	for _, track := range []webrtc.TrackLocal{videoTrack, audioTrack} {
		sender, err := connection.AddTrack(track)
		if err != nil {
			leave()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// A player whose picture broke asks for a whole one
		go func() {
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
		}()
	}
	connection.OnDataChannel(func(channel *webrtc.DataChannel) {
		if channel.Label() == "input" {
			channel.OnMessage(func(message webrtc.DataChannelMessage) { pads[player].set(message.Data) })
		}
	})
	connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("player %d: %s", player+1, state)
		switch state {
		case webrtc.PeerConnectionStateConnected:
			wantKey.Store(true)
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			_ = connection.Close()
			leave()
		}
	})
	if err := connection.SetRemoteDescription(offer); err != nil {
		leave()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	answer, err := connection.CreateAnswer(nil)
	check(err)
	gathered := webrtc.GatheringCompletePromise(connection)
	check(connection.SetLocalDescription(answer))
	<-gathered
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"player": player + 1, "sdp": connection.LocalDescription().SDP, "type": "answer"})
}

func mustListenUDP(address string) *net.UDPConn {
	resolved, err := net.ResolveUDPAddr("udp4", address)
	check(err)
	conn, err := net.ListenUDP("udp4", resolved)
	check(err)
	return conn
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
