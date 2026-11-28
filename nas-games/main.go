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
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

const (
	padStateSize = 7
	// The controller, then where the stylus is on the picture and whether it's down: x and y, 0 to 65535 across it
	padWithPointerSize = 12
	// The most the picture may take, in kilobits a second; less while a player's network loses it (players.go)
	kilobits = 6000
	// The least time between two whole pictures (keyframes). Each is large, and a player whose network keeps losing
	// the picture would otherwise ask for one after another, for every player
	keyframeEvery = 500 * time.Millisecond
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
	// Something went wrong that the game can't go on from: it ends, keeping its save first, and says it failed
	failed     atomic.Bool
	paused     atomic.Bool
	restarting atomic.Bool
	pads       [4]pad
)

// One player's controller, as the core reads it: RetroPad buttons as bits, and the two sticks
type pad struct {
	mu      sync.Mutex
	buttons uint16
	axes    [4]int16
	// The stylus, for a DS's touch screen, as libretro takes it: -0x7fff to 0x7fff across the picture
	pointerX, pointerY int16
	// Whether the stylus is down, as the frame loop reads it. A press is held down until a frame has run with it: a
	// quick tap's down and up can both arrive between two frames, and the up would otherwise undo the down unseen
	pointerDown bool
	// A press no frame has run with yet, and a release that came before one did
	pressUnseen, releaseHeld bool
}

// Standard gamepad buttons, in the order the browser numbers them, as RetroPad ids
var retroPadID = [16]uint{0, 8, 1, 9, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7}

// set takes a controller as play together sends it: three bytes of buttons, a bit each, then a signed byte per axis
func (p *pad) set(state []byte) {
	if len(state) != padStateSize && len(state) != padWithPointerSize {
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
	down := false
	if len(state) == padWithPointerSize {
		across := func(value uint16) int16 { return int16(math.Round(float64(value)/65535*0xfffe - 0x7fff)) }
		p.pointerX = across(uint16(state[7]) | uint16(state[8])<<8)
		p.pointerY = across(uint16(state[9]) | uint16(state[10])<<8)
		down = state[11] != 0
	}
	switch {
	case down:
		if !p.pointerDown {
			p.pressUnseen = true
		}
		p.pointerDown, p.releaseHeld = true, false
	case p.pressUnseen:
		p.releaseHeld = true
	default:
		p.pointerDown = false
	}
}

// seen is told when a frame has run with the controller as it is: a press held for it is let go, if it was
func (p *pad) seen() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pressUnseen {
		p.pressUnseen = false
		if p.releaseHeld {
			p.pointerDown, p.releaseHeld = false, false
		}
	}
}

func (p *pad) clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.buttons, p.axes = 0, [4]int16{}
	p.pointerX, p.pointerY, p.pointerDown, p.pressUnseen, p.releaseHeld = 0, 0, false, false, false
}

// takeFrom moves another pad's state here, for a player whose number moves down, and clears the other
func (p *pad) takeFrom(other *pad) {
	other.mu.Lock()
	buttons, axes, x, y, down := other.buttons, other.axes, other.pointerX, other.pointerY, other.pointerDown
	other.mu.Unlock()
	other.clear()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.buttons, p.axes, p.pointerX, p.pointerY, p.pointerDown = buttons, axes, x, y, down
	p.pressUnseen, p.releaseHeld = false, false
}

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
	corePath, game := os.Getenv("CORE_PATH"), os.Getenv("GAME")
	if corePath == "" || game == "" {
		log.Fatal("CORE_PATH and GAME are needed: the game service (serve) sets them")
	}
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
	soundRate.Store(math.Float64bits(float64(C.fe_sample_rate())))
	setAspect(float64(C.fe_aspect()))
	// Named after the library's copy of the game, the same whichever name the game is started under
	savePath := filepath.Join(saveDir, envOr("SAVE_NAME", strings.TrimSuffix(filepath.Base(game), filepath.Ext(game)))+".srm")
	restoreSave(savePath)
	listenToPartner()

	// Asked to end: the game's own save is kept, then it ends
	ending := make(chan os.Signal, 1)
	signal.Notify(ending, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-ending
		stopping.Store(true)
	}()

	startNetwork()
	period := time.Duration(float64(time.Second) / fps)
	framePeriod.Store(int64(period))
	pictures := make(chan picture, 2)
	sounds := make(chan []int16, 16)
	go encodePictures(pictures, fps)
	go encodeSound(sounds)
	go report()
	go tellPlayersEverySecond()
	run(period, pictures, sounds, savePath)
}

// fail ends the game on something it can't go on from, outside the frame loop: the frame loop keeps the game's own
// save, and the game ends saying it failed. The goroutine that failed waits for that
func fail(format string, args ...any) {
	log.Printf("failed: "+format, args...)
	failed.Store(true)
	stopping.Store(true)
	select {}
}

// The time one frame takes, as the core has it now, and the rate of its sound: both can change as it runs
var (
	framePeriod atomic.Int64
	soundRate   atomic.Uint64
)

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
	// Which of the game's frames it is, counted from the start, paused ones included. A game that shows the same
	// picture again sends nothing for it, so the numbers say how much time passed between two pictures sent
	frame int64
	// How long a frame was, then
	period time.Duration
}

// run plays the game a frame at a time, at its own frame rate, and hands each new picture and its sound on at once
func run(period time.Duration, pictures chan<- picture, sounds chan<- []int16, savePath string) {
	buffer := make([]byte, 4096*2048*3/2)
	sound := make([]int16, 48000*2)
	next := time.Now()
	lastSave := time.Now()
	var saved []byte
	// The latest frame sent, for a save state's picture, and to send again to a player who has just joined
	var last picture
	// The latest frame made while nobody was watching, left in `buffer` and copied out only if it's wanted
	var unsent picture
	var resent time.Time
	var frame int64
	send := func(p picture) {
		select {
		case pictures <- p:
		default:
			counters.Lock()
			counters.dropped++
			counters.Unlock()
		}
	}
	keepUnsent := func() {
		if unsent.data != nil {
			last = unsent
			last.data = slices.Clone(unsent.data)
			unsent = picture{}
		}
	}
	for {
		frame++
		setControllers()
		if restarting.Swap(false) {
			C.fe_reset()
		}
		// Save states asked for, saved or loaded between frames, paused or not
		if len(stateRequests) > 0 {
			keepUnsent()
		}
		handleStateRequests(&last)
		sent := false
		// Paused, the game stands still, and nothing new is sent
		if !paused.Load() {
			started := time.Now()
			C.fe_run()
			for port := range pads {
				pads[port].seen()
			}
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
			if changes := int(C.fe_take_av_changes()); changes != 0 {
				period = takeChanges(changes, period)
			}
			if size > 0 {
				current := picture{buffer[:size], int(width), int(height), frame, period}
				if players.Load() > 0 {
					unsent = picture{}
					last = current
					last.data = slices.Clone(current.data)
					send(last)
					sent = true
				} else {
					// Nobody watching: nothing is encoded, or copied
					unsent = current
				}
			}
			if frames := int(C.fe_take_sound((*C.int16_t)(unsafe.Pointer(&sound[0])), C.int(len(sound)/2))); frames > 0 {
				sounds <- slices.Clone(sound[:frames*2])
			}
		}
		// A whole picture is wanted (a player has just joined, or lost theirs) and the game hasn't drawn a new one: paused,
		// or showing the same picture. The picture as it stands is sent again, as often as the encoder may make it whole
		if !sent && wantKey.Load() && players.Load() > 0 && time.Since(resent) > 100*time.Millisecond {
			keepUnsent()
			if last.data != nil {
				again := last
				again.frame, again.period = frame, period
				send(again)
				resent = time.Now()
			}
		}
		if stopping.Load() {
			finish(savePath, saved)
		}
		if time.Since(lastSave) > 10*time.Second {
			lastSave = time.Now()
			// A save that couldn't be written is tried again at the next
			saved, _ = keepSave(savePath, saved)
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

// setControllers hands the core each player's controller, for the next frame
func setControllers() {
	// The stylus is the first player's who has it down, or else where the first player left it
	stylusSet := false
	for port := range pads {
		p := &pads[port]
		p.mu.Lock()
		if !stylusSet && (p.pointerDown || port == 0) {
			down := 0
			if p.pointerDown {
				down = 1
			}
			C.fe_set_pointer(C.int16_t(p.pointerX), C.int16_t(p.pointerY), C.int(down))
			stylusSet = p.pointerDown
		}
		C.fe_set_pad(C.int(port), C.uint16_t(p.buttons), C.int16_t(p.axes[0]), C.int16_t(p.axes[1]),
			C.int16_t(p.axes[2]), C.int16_t(p.axes[3]))
		p.mu.Unlock()
	}
}

// takeChanges applies what the core changed as it ran: the picture's shape, told to the players, and the frame rate
// and sound rate. The frame's length, as it is now
func takeChanges(changes int, period time.Duration) time.Duration {
	if changes&1 != 0 {
		if shape := float64(C.fe_aspect()); shape > 0 && shape != getAspect() {
			setAspect(shape)
			tellPictureShape()
		}
	}
	if changes&2 != 0 {
		if fps := float64(C.fe_fps()); fps > 0 {
			period = time.Duration(float64(time.Second) / fps)
			framePeriod.Store(int64(period))
		}
		if rate := float64(C.fe_sample_rate()); rate > 0 {
			soundRate.Store(math.Float64bits(rate))
		}
		log.Printf("now %.2f fps, sound at %.0f Hz", float64(time.Second)/float64(period), float64(C.fe_sample_rate()))
	}
	return period
}

// finish ends the game: its own save kept, players told, the core stopped. It ends saying it failed if the game
// failed, or its save couldn't be kept, so the service can tell
func finish(savePath string, saved []byte) {
	_, err := keepSave(savePath, saved)
	if err != nil {
		log.Printf("failed: the game's own save couldn't be kept as it ended: %v", err)
	}
	closeConnections()
	// Long enough for the goodbyes to leave
	time.Sleep(300 * time.Millisecond)
	C.fe_unload()
	if err != nil || failed.Load() {
		os.Exit(1)
	}
	log.Printf("ended")
	os.Exit(0)
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

// keepSave writes the game's own save when it has changed since `last`, the save as last written. It returns the save
// as written now, or `last` again if it couldn't be, so it's tried again
func keepSave(path string, last []byte) ([]byte, error) {
	current := saveRAM()
	if current == nil || bytes.Equal(current, last) {
		return last, nil
	}
	if last == nil && !anyNonZero(current) {
		// Nothing saved yet, and nothing to save
		return current, nil
	}
	if err := writeWhole(path, current); err != nil {
		log.Printf("save not kept: %v", err)
		return last, err
	}
	// The file's name alone: the folder is the player's
	log.Printf("save kept: %s", filepath.Base(path))
	return current, nil
}

// writeWhole writes a file beside the old one, then names it as the old one: a save collected as it's written is the
// old one or the new one, never part of one, and a write that fails leaves the old one as it was
func writeWhole(path string, data []byte) error {
	part := path + ".part"
	file, err := os.OpenFile(part, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(part, path)
	}
	if err != nil {
		_ = os.Remove(part)
	}
	return err
}

func anyNonZero(data []byte) bool {
	return slices.ContainsFunc(data, func(b byte) bool { return b != 0 })
}

// encodePictures encodes each picture as H.264 the moment it arrives and sends it to every player. The encoder is made
// as large as the largest picture so far, and smaller ones are scaled to it: a game that changes its picture's size
// as it goes, for its menus or a high-resolution mode, doesn't need a new encoder, and players a new stream, each time
func encodePictures(pictures <-chan picture, fps float64) {
	var encoder *C.video_encoder
	width, height := 0, 0
	var previous int64
	var lastKey time.Time
	rate := kilobits
	for p := range pictures {
		if encoder == nil || p.width > width || p.height > height {
			if encoder != nil {
				C.ve_free(encoder)
			}
			width, height = max(width, p.width), max(height, p.height)
			encoder = C.ve_new(C.int(width), C.int(height), C.double(fps), C.int(rate))
			if encoder == nil {
				fail("no encoder for %dx%d", width, height)
			}
			log.Printf("encoding %dx%d at %.2f fps", width, height, fps)
			wantKey.Store(true)
			lastKey = time.Time{}
		}
		if target := lowestEstimate(); target != rate {
			rate = target
			C.ve_set_bitrate(encoder, C.int(rate))
		}
		keyframe := 0
		if time.Since(lastKey) >= keyframeEvery && wantKey.CompareAndSwap(true, false) {
			keyframe = 1
			lastKey = time.Now()
		}
		started := time.Now()
		var out *C.uint8_t
		size := int(C.ve_encode(encoder, (*C.uint8_t)(unsafe.Pointer(&p.data[0])), C.int(p.width), C.int(p.height),
			C.int(keyframe), C.int64_t(p.frame), &out))
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
			// The frames since the last picture sent, beyond the one that picture took up: this picture's timestamp
			// moves on past them, so a browser shows it when it was made. Without that, a game that repeats pictures,
			// as most do when they run at 30 frames a second or less, looks to the browser as if each picture were
			// late, and it holds the stream back further and further to make up, with long stops between pictures.
			// An empty sample moves the timestamp on and sends nothing, so they aren't taken for lost packets
			if skipped := min(p.frame-previous-1, 1000); previous > 0 && skipped > 0 {
				_ = videoTrack.WriteSample(media.Sample{Duration: time.Duration(skipped) * p.period})
			}
			previous = p.frame
			_ = videoTrack.WriteSample(media.Sample{Data: data, Duration: p.period})
		}
	}
}

// encodeSound turns the core's sound into 10 ms Opus packets as it comes. Cores make sound in bursts, some of several
// frames' worth at once; sent as made, the bursts look to a browser like an unsteady network, and it buffers a fifth of
// a second against them. So the packets go out on a steady 10 ms clock instead, with a few kept in hand
func encodeSound(sounds <-chan []int16) {
	rate := math.Float64frombits(soundRate.Load())
	encoder := C.se_new(C.double(rate))
	const capacity = 1500
	out := make([]byte, capacity*64)
	sizes := make([]C.int, 64)
	queue := make(chan []byte, 64)
	go paceSound(queue)
	for samples := range sounds {
		if now := math.Float64frombits(soundRate.Load()); now != rate {
			rate = now
			C.se_set_rate(encoder, C.double(rate))
		}
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

// report logs the game's numbers over five seconds when it struggles (slower than it should run, or pictures
// dropped), and otherwise once a minute: the log is kept
func report() {
	var lastLogged time.Time
	for range time.Tick(5 * time.Second) {
		counters.Lock()
		const seconds = 5.0
		aim := float64(time.Second) / float64(framePeriod.Load())
		fps := float64(counters.frames) / seconds
		struggling := counters.frames > 0 && (fps < aim*0.95 || counters.dropped > 0)
		if counters.frames > 0 && (struggling || time.Since(lastLogged) >= time.Minute) {
			lastLogged = time.Now()
			log.Printf("game %.1f fps (aim %.2f), run %.1f ms avg %.1f max, encode %.1f ms avg %.1f max, %.2f Mbps, "+
				"dropped %d, keyframes %d, sound packets %d, players %d",
				fps, aim, ms(counters.run.total)/float64(counters.frames), ms(counters.run.max),
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

// ---- Network: WebRTC, and player slots ----

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
		// The networks are looked at once, now: one that's down as the game starts (Tailscale restarting, say) isn't
		// offered for the whole game, and its players can't reach it
		for name := range allowed {
			if !hasIPv4(name) {
				log.Printf("warning: network %s has no address now; players on it can't reach this game", name)
			}
		}
		port, err := strconv.Atoi(mediaPort)
		check(err)
		mux, err := ice.NewMultiUDPMuxFromPort(port,
			ice.UDPMuxFromPortWithInterfaceFilter(func(name string) bool { return allowed[name] }),
			ice.UDPMuxFromPortWithNetworks(ice.NetworkTypeUDP4))
		check(err)
		settings.SetICEUDPMux(mux)
		addresses = []string{names}
	} else if reachable := os.Getenv("REACHABLE_AT"); reachable != "" {
		// In a container of its own, its address is useless outside it; these are where the NAS is reached
		settings.SetICEUDPMux(webrtc.NewICEUDPMux(nil, mustListenUDP(":"+mediaPort)))
		addresses = strings.Split(reachable, ",")
		settings.SetNAT1To1IPs(addresses, webrtc.ICECandidateTypeHost)
	} else {
		log.Fatal("ICE_INTERFACES or REACHABLE_AT is needed: where players reach the NAS")
	}
	settings.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	api = webrtc.NewAPI(webrtc.WithSettingEngine(settings))

	http.HandleFunc("POST /players", handleNewPlayer)
	http.HandleFunc("POST /players/{player}/answer", handlePlayerAnswer)
	http.HandleFunc("GET /status", handleStatus)
	http.HandleFunc("GET /states", handleListStates)
	http.HandleFunc("POST /states", handleSaveState)
	http.HandleFunc("GET /states/{id}/picture", handleStatePicture)
	http.HandleFunc("POST /states/{id}/load", handleLoadState)
	log.Printf("listening on %s, media on udp %s, reachable at %v", httpAddress, mediaPort, addresses)
	go func() {
		if err := http.ListenAndServe(httpAddress, nil); err != nil {
			fail("can't listen on %s: %v", httpAddress, err)
		}
	}()
}

// hasIPv4 says whether a network interface has an IPv4 address
func hasIPv4(name string) bool {
	device, err := net.InterfaceByName(name)
	if err != nil {
		return false
	}
	addresses, err := device.Addrs()
	if err != nil {
		return false
	}
	for _, address := range addresses {
		if ip, ok := address.(*net.IPNet); ok && ip.IP.To4() != nil {
			return true
		}
	}
	return false
}

var slots struct {
	sync.Mutex
	taken [4]bool
	// Connected players' numbers, which move down as lower ones come free
	connected map[*atomic.Int32]bool
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

// connectSlot counts a player who has just connected as connected, and gives them a lower player number if one is
// free: someone rejoining a game, whose old connection was still closing when they asked for a place, is player 1
// again rather than player 2, whose controller a game for one doesn't read
func connectSlot(slot *atomic.Int32) {
	slots.Lock()
	defer slots.Unlock()
	if slots.connected == nil {
		slots.connected = map[*atomic.Int32]bool{}
	}
	slots.connected[slot] = true
	moveSlotsDown()
}

// freeSlot gives a player's number back, and moves the players above it down: a player who moved to another device,
// or whose old connection closed late, is player 1 once the old one has gone
func freeSlot(slot *atomic.Int32) {
	slots.Lock()
	defer slots.Unlock()
	delete(slots.connected, slot)
	index := slot.Load()
	if slots.taken[index] {
		slots.taken[index] = false
		players.Add(-1)
		pads[index].clear()
	}
	moveSlotsDown()
}

// moveSlotsDown moves each free player number's next connected player down into it. A place held for a player who
// hasn't connected yet stays theirs. With slots held
func moveSlotsDown() {
	for index := range slots.taken {
		if slots.taken[index] {
			continue
		}
		var next *atomic.Int32
		for slot := range slots.connected {
			if from := int(slot.Load()); from > index && (next == nil || from < int(next.Load())) {
				next = slot
			}
		}
		if next == nil {
			return
		}
		from := int(next.Load())
		slots.taken[index], slots.taken[from] = true, false
		pads[index].takeFrom(&pads[from])
		next.Store(int32(index))
		log.Printf("player %d: now player %d", from+1, index+1)
	}
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

// check ends the game on an error while it starts, before it has anything to keep
func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
