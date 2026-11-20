package cdn

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"

	"github.com/gen2brain/webp"

	"retroassembly/server/internal/ids"
)

// Box art and artwork are large PNGs (an arcade box can be 700 KB) shown at a small size. A WebP copy, made once and
// kept next to the cached file, is about a seventh of the size at the same dimensions. It's made with libwebp translated
// to Go, built into the server (the nodynamic build tag keeps it from loading a system libwebp instead, which would
// make the server a dynamically linked binary), at the quality sharp made it at on the Node server
const webPQuality = 82

// The largest picture converted, in pixels: far more than any cover or screenshot
const maxWebPPixels = 40_000_000

var webPSources = map[string]bool{"image/jpeg": true, "image/png": true}

// Each conversion takes tens of MB of its own while it runs, so a page full of covers converts two at a time, and the
// memory is given back to the system once the last is done rather than whenever Go gets round to it
var (
	conversionSlots   = make(chan struct{}, 2)
	conversionsMutex  sync.Mutex
	conversionsActive int
)

func startConversion() {
	conversionSlots <- struct{}{}
	conversionsMutex.Lock()
	conversionsActive++
	conversionsMutex.Unlock()
}

func endConversion() {
	conversionsMutex.Lock()
	conversionsActive--
	last := conversionsActive == 0
	conversionsMutex.Unlock()
	<-conversionSlots
	if last {
		debug.FreeOSMemory()
	}
}

func convertToWebP(source, copy string) (string, error) {
	sourceInfo, err := os.Stat(source)
	if err != nil {
		return "", nil
	}
	// A copy older than the file (which has been downloaded again since) is made again
	if copyInfo, err := os.Stat(copy); err == nil && !copyInfo.ModTime().Before(sourceInfo.ModTime()) {
		return copy, nil
	}
	startConversion()
	defer endConversion()
	file, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer file.Close()
	// A picture is measured before it's decoded: a small file can claim a huge picture, and decoding it would take GBs
	size, _, err := image.DecodeConfig(file)
	if err != nil {
		return "", err
	}
	if size.Width*size.Height > maxWebPPixels {
		return "", fmt.Errorf("%s is %dx%d, too large to convert", source, size.Width, size.Height)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	picture, _, err := image.Decode(file)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(copy), 0o777); err != nil {
		return "", err
	}
	temporary := copy + "." + ids.New() + ".tmp"
	defer os.Remove(temporary)
	output, err := os.Create(temporary)
	if err != nil {
		return "", err
	}
	if err := webp.Encode(output, picture, webp.Options{Method: 4, Quality: webPQuality}); err != nil {
		output.Close()
		return "", err
	}
	if err := output.Close(); err != nil {
		return "", err
	}
	return copy, os.Rename(temporary, copy)
}

// WebPCopy is the path and size of a WebP copy of a cached image, made the first time it's asked for; empty for a file
// that isn't an image that can be converted, or one that couldn't be. One conversion per file at a time, however many
// pages ask for it at once
func (c *Cache) WebPCopy(entry *Entry) (string, int64) {
	contentType, _, _ := strings.Cut(entry.ContentType, ";")
	if !webPSources[strings.ToLower(strings.TrimSpace(contentType))] {
		return "", 0
	}
	copy := entry.WebPPath
	if copy == "" {
		copy = entry.Path + ".webp"
	}
	path, err := c.once(c.conversions, entry.Path, func() (string, error) { return convertToWebP(entry.Path, copy) })
	if err != nil || path == "" {
		return "", 0
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", 0
	}
	return path, info.Size()
}
