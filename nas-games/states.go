package main

/*
#include <stdlib.h>
#include "frontend.h"
*/
import "C"

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unsafe"
)

// Save states of a game on the NAS: the game as it is at a moment, to go back to. They're kept on the NAS, in the
// folder of the player who started the game, with a picture of the moment: the NAS's emulators are other builds than
// the browser's, and their states don't load in each other. Saving and loading happen between frames, as the core runs
// on one thread: a request waits for the frame loop to take it.
//
//	GET  /states            -> the game's states, newest first
//	POST /states            -> the new state; with ?auto=1, one the game service keeps as it stops a game left idle
//	GET  /states/{id}/picture
//	POST /states/{id}/load
//
// The service gives each game a folder of states for the player, the game and the emulator, as one emulator's states
// don't load in another's. States kept automatically are in a folder of their own in it, with a limit of their own, so
// they never take the place of the player's own

// How many states a player keeps of a game, and how many automatic ones; past these, the oldest go
const (
	keptStates     = 20
	keptAutoStates = 3
)

var validStateID = regexp.MustCompile(`^[0-9]{8}-[0-9]{9}$`)

type stateInfo struct {
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
	// Its size on the NAS, compressed
	Size int64 `json:"size"`
	// Kept by the service as it stopped the game, not by a player
	Auto bool `json:"auto,omitempty"`
}

// A state is taken or put back between frames, and only that: compressing it and the files are done after, outside
// the frame loop, so the game doesn't stall for them
type stateRequest struct {
	load []byte // the state to put back; none to take one
	done chan stateResult
}

type stateResult struct {
	data    []byte  // the state taken
	picture picture // the frame it was taken at
	err     error
}

var stateRequests = make(chan stateRequest, 4)

func statesDir() string { return envOr("STATES_DIR", "/config/states") }

// The folder a state is kept in: the player's, or the automatic ones'
func statesFolder(auto bool) string {
	if auto {
		return filepath.Join(statesDir(), "auto")
	}
	return statesDir()
}

// A state's file: compressed. Uncompressed ones from before are still read
const stateExtension = ".state.gz"

// stateFile is where a state is, in either folder; its picture is beside it
func stateFile(id string) string {
	for _, auto := range []bool{false, true} {
		for _, extension := range []string{stateExtension, ".state"} {
			path := filepath.Join(statesFolder(auto), id+extension)
			if _, err := os.Stat(path); err == nil {
				return path
			}
		}
	}
	return filepath.Join(statesDir(), id+stateExtension)
}

// listStates is the game's states, the player's and the automatic ones, newest first
func listStates() []stateInfo {
	states := append(statesIn(false), statesIn(true)...)
	sort.Slice(states, func(a, b int) bool { return states[a].ID > states[b].ID })
	return states
}

// statesIn is the states in one folder, newest first
func statesIn(auto bool) []stateInfo {
	files, _ := filepath.Glob(filepath.Join(statesFolder(auto), "*.state*"))
	states := make([]stateInfo, 0, len(files))
	for _, file := range files {
		info, err := os.Stat(file)
		name := filepath.Base(file)
		id := strings.TrimSuffix(strings.TrimSuffix(name, ".gz"), ".state")
		if err != nil || !validStateID.MatchString(id) {
			continue
		}
		states = append(states, stateInfo{Auto: auto, Created: info.ModTime(), ID: id, Size: info.Size()})
	}
	sort.Slice(states, func(a, b int) bool { return states[a].ID > states[b].ID })
	return states
}

// handleStateRequests takes or puts back a state, for each request waiting, between frames. `last` is the latest
// frame, for a new state's picture
func handleStateRequests(last *picture) {
	for {
		select {
		case request := <-stateRequests:
			if request.load != nil {
				request.done <- putState(request.load)
			} else {
				request.done <- takeState(last)
			}
		default:
			return
		}
	}
}

func takeState(last *picture) stateResult {
	size := int(C.fe_state_size())
	if size <= 0 {
		return stateResult{err: errors.New("this game can't be saved as a state")}
	}
	data := make([]byte, size)
	if C.fe_save_state(unsafe.Pointer(&data[0]), C.size_t(size)) == 0 {
		return stateResult{err: errors.New("the emulator couldn't save its state")}
	}
	result := stateResult{data: data}
	if last != nil {
		result.picture = *last
	}
	return result
}

func putState(data []byte) stateResult {
	if C.fe_load_state(unsafe.Pointer(&data[0]), C.size_t(len(data))) == 0 {
		return stateResult{err: errors.New("the emulator couldn't load that state")}
	}
	wantKey.Store(true)
	return stateResult{}
}

// keepState writes a state taken, compressed, with its picture, and lets the oldest of its kind go past the newest
// few
func keepState(taken stateResult, auto bool) (stateInfo, error) {
	folder := statesFolder(auto)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return stateInfo{}, err
	}
	now := time.Now()
	// The date, time and millisecond it was saved: yyyymmdd-hhmmssmmm, which sorts oldest first
	id := now.UTC().Format("20060102-150405") + fmt.Sprintf("%03d", now.Nanosecond()/int(time.Millisecond))
	var compressed bytes.Buffer
	// The fastest setting: states are mostly empty memory, which any setting packs small
	writer, _ := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if _, err := writer.Write(taken.data); err != nil {
		return stateInfo{}, err
	}
	if err := writer.Close(); err != nil {
		return stateInfo{}, err
	}
	// Written whole, then named, so a state is never seen half written
	path := filepath.Join(folder, id+stateExtension)
	if err := os.WriteFile(path+".part", compressed.Bytes(), 0o644); err != nil {
		return stateInfo{}, err
	}
	if err := os.Rename(path+".part", path); err != nil {
		return stateInfo{}, err
	}
	if taken.picture.data != nil {
		_ = os.WriteFile(filepath.Join(folder, id+".jpg"), pictureJPEG(taken.picture), 0o644)
	}
	kept := keptStates
	if auto {
		kept = keptAutoStates
	}
	states := statesIn(auto)
	for _, old := range states[min(len(states), kept):] {
		_ = os.Remove(stateFile(old.ID))
		_ = os.Remove(filepath.Join(folder, old.ID+".jpg"))
	}
	return stateInfo{Auto: auto, Created: now, ID: id, Size: int64(compressed.Len())}, nil
}

// readState is a state kept, uncompressed
func readState(id string) ([]byte, error) {
	path := stateFile(id)
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("no such state")
	}
	defer file.Close()
	if !strings.HasSuffix(path, ".gz") {
		return io.ReadAll(file)
	}
	reader, err := gzip.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(io.LimitReader(reader, 1<<30))
}

// pictureJPEG is a frame, as the encoder takes it (I420), as a JPEG
func pictureJPEG(p picture) []byte {
	w, h := p.width, p.height
	frame := &image.YCbCr{
		Y: p.data[:w*h], Cb: p.data[w*h : w*h+w*h/4], Cr: p.data[w*h+w*h/4 : w*h*3/2],
		YStride: w, CStride: w / 2, SubsampleRatio: image.YCbCrSubsampleRatio420, Rect: image.Rect(0, 0, w, h),
	}
	var out bytes.Buffer
	_ = jpeg.Encode(&out, frame, &jpeg.Options{Quality: 80})
	return out.Bytes()
}

func askFrameLoop(load []byte) stateResult {
	request := stateRequest{done: make(chan stateResult, 1), load: load}
	select {
	case stateRequests <- request:
	case <-time.After(5 * time.Second):
		return stateResult{err: errors.New("the game is busy")}
	}
	select {
	case result := <-request.done:
		return result
	case <-time.After(15 * time.Second):
		return stateResult{err: errors.New("the game didn't answer")}
	}
}

func handleListStates(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(listStates())
}

func handleSaveState(w http.ResponseWriter, r *http.Request) {
	taken := askFrameLoop(nil)
	if taken.err != nil {
		http.Error(w, taken.err.Error(), http.StatusConflict)
		return
	}
	info, err := keepState(taken, r.URL.Query().Get("auto") == "1")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(info)
}

func handleLoadState(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validStateID.MatchString(id) {
		http.Error(w, "no such state", http.StatusNotFound)
		return
	}
	data, err := readState(id)
	if err != nil || len(data) == 0 {
		http.Error(w, "no such state", http.StatusNotFound)
		return
	}
	if result := askFrameLoop(data); result.err != nil {
		http.Error(w, result.err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleStatePicture(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validStateID.MatchString(id) {
		http.Error(w, "no such state", http.StatusNotFound)
		return
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(stateFile(id)), id+".jpg"))
	if err != nil {
		http.Error(w, "no picture", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(data)
}
