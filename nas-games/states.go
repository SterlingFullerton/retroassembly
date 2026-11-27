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
//	POST /states            -> the new state
//	GET  /states/{id}/picture
//	POST /states/{id}/load

// How many states a player keeps of a game; past this, the oldest go
const keptStates = 20

var validStateID = regexp.MustCompile(`^[0-9]{8}-[0-9]{9}$`)

type stateInfo struct {
	ID      string    `json:"id"`
	Created time.Time `json:"created"`
	// Its size on the NAS, compressed
	Size int64 `json:"size"`
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

// A state's file: compressed. Uncompressed ones from before are still read
const stateExtension = ".state.gz"

func stateFile(id string) string {
	compressed := filepath.Join(statesDir(), id+stateExtension)
	if _, err := os.Stat(compressed); err == nil {
		return compressed
	}
	return filepath.Join(statesDir(), id+".state")
}

func listStates() []stateInfo {
	files, _ := filepath.Glob(filepath.Join(statesDir(), "*.state*"))
	states := make([]stateInfo, 0, len(files))
	for _, file := range files {
		info, err := os.Stat(file)
		name := filepath.Base(file)
		id := strings.TrimSuffix(strings.TrimSuffix(name, ".gz"), ".state")
		if err != nil || !validStateID.MatchString(id) {
			continue
		}
		states = append(states, stateInfo{Created: info.ModTime(), ID: id, Size: info.Size()})
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

// keepState writes a state taken, compressed, with its picture, and lets the oldest go past the newest few
func keepState(taken stateResult) (stateInfo, error) {
	if err := os.MkdirAll(statesDir(), 0o755); err != nil {
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
	path := filepath.Join(statesDir(), id+stateExtension)
	if err := os.WriteFile(path+".part", compressed.Bytes(), 0o644); err != nil {
		return stateInfo{}, err
	}
	if err := os.Rename(path+".part", path); err != nil {
		return stateInfo{}, err
	}
	if taken.picture.data != nil {
		_ = os.WriteFile(filepath.Join(statesDir(), id+".jpg"), pictureJPEG(taken.picture), 0o644)
	}
	states := listStates()
	for _, old := range states[min(len(states), keptStates):] {
		_ = os.Remove(stateFile(old.ID))
		_ = os.Remove(filepath.Join(statesDir(), old.ID+".jpg"))
	}
	return stateInfo{Created: now, ID: id, Size: int64(compressed.Len())}, nil
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

func handleSaveState(w http.ResponseWriter, _ *http.Request) {
	taken := askFrameLoop(nil)
	if taken.err != nil {
		http.Error(w, taken.err.Error(), http.StatusConflict)
		return
	}
	info, err := keepState(taken)
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
	data, err := os.ReadFile(filepath.Join(statesDir(), id+".jpg"))
	if err != nil {
		http.Error(w, "no picture", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(data)
}
