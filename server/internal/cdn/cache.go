package cdn

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/ids"
	"retroassembly/server/internal/trust"
)

const (
	fetchTimeout = 120 * time.Second
	// A host that doesn't answer within this long is taken to be unreachable
	headersTimeout = 10 * time.Second
	// The largest file the cache keeps. What the app loads through it, images, fonts and shaders, is far smaller
	maxDownloadSize = 64 << 20
	// Files that don't exist upstream are remembered for this long by default (CDN_RECHECK_DAYS), and forever for pinned
	// versions
	DefaultRecheck = 30 * 24 * time.Hour
	// After a host fails to answer, requests to it are skipped for this long, so pages load quickly while offline
	unreachableBackoff = 5 * time.Minute
)

// Cache is the server's copy of CDN files
type Cache struct {
	*Data
	// cache/cdn in the data folder, where files are kept under the hash of their address
	directory string
	// Where libretro's art is kept under its own names, when set
	artwork string
	client  *http.Client
	// With CDN_OFFLINE=true, pages get only what's in the cache, and nothing is downloaded while
	// they're browsed; files are added only by the prefetch
	Offline bool
	// How long a file found missing upstream is remembered before it's looked for again; zero for forever
	// (CDN_RECHECK_DAYS)
	Recheck time.Duration
	// The file name of a game's best front cover on LaunchBox's image server, by its LaunchBox id; empty for none.
	// Unset, LaunchBox's covers aren't used
	LaunchboxCovers func(databaseID string) string
	// Whether downloaded images are kept as they came beside their WebP copy. Without them (CDN_KEEP_ORIGINALS=false),
	// an image is kept only as its WebP copy, a seventh of the size, and that's what every browser is sent
	KeepOriginals bool

	mutex       sync.Mutex
	downloads   map[string]*call
	unreachable map[string]time.Time
	conversions map[string]*call
	coverLists  map[string]*coverList
	coverParses map[string]*call
}

type call struct {
	done   chan struct{}
	err    error
	result string
}

func New(data *Data, directories config.Directories, offline bool, extraCertificates string) *Cache {
	dialer := &net.Dialer{Timeout: headersTimeout}
	transport := trust.Transport(extraCertificates)
	transport.DialContext = dialer.DialContext
	return &Cache{
		Data: data, directory: filepath.Join(directories.Cache, "cdn"), artwork: directories.Artwork,
		client: &http.Client{Transport: transport}, Offline: offline, Recheck: DefaultRecheck, KeepOriginals: true,
		downloads: map[string]*call{}, unreachable: map[string]time.Time{}, conversions: map[string]*call{},
		coverLists: map[string]*coverList{}, coverParses: map[string]*call{},
	}
}

// What the cache notes about a file, in its .json
type note struct {
	ContentType string  `json:"contentType"`
	Status      int     `json:"status"`
	Time        float64 `json:"time"`
}

// Entry is a file the cache has, or knows not to exist upstream (Status 404)
type Entry struct {
	ContentType string
	Path        string
	Size        int64
	// Last found missing long ago, so to be looked for again
	Stale  bool
	Status int
	// When it was downloaded, in milliseconds
	Time     float64
	WebPPath string
}

// libretro's art folders: Named_Boxarts, Named_Titles, Named_Snaps and Named_Logos
var libretroArtFolder = regexp.MustCompile(`^Named_[A-Z][a-z]+s$`)

// decodeName reads a part of an address, keeping a "%" that isn't followed by two hex digits as it is, as in
// "Cotton 100% (Japan).png"
func decodeName(segment string) (string, error) {
	var builder strings.Builder
	for i := 0; i < len(segment); i++ {
		if segment[i] == '%' && !(i+2 < len(segment) && isHex(segment[i+1]) && isHex(segment[i+2])) {
			builder.WriteString("%25")
			continue
		}
		builder.WriteByte(segment[i])
	}
	return DecodeURIComponent(builder.String())
}

// isUsableName tells whether a name can be a file or folder here: not one that would step outside its folder, is
// hidden, holds a control character, or is too long for the disk with what's added to it
func isUsableName(name string) bool {
	if strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") || len(name) > 200 {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// ArtworkPath is where a libretro cover, title screen or screenshot goes in the artwork folder, by libretro's own
// layout, as in "Nintendo - Game Boy/Named_Boxarts/Tetris (World).png"; the layout RetroArch keeps its thumbnails in,
// so art put there by hand is found too. Empty for anything else, or when no artwork folder is set
func ArtworkPath(artwork, href string) string {
	if artwork == "" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(pathname(href), "/"), "/")
	var segments []string
	if strings.HasPrefix(href, LibretroHost) {
		segments = parts
	} else if strings.HasPrefix(href, CDNHost) && parts[0] == "gh" && len(parts) > 1 && parts[1] == "libretro-thumbnails" {
		// jsDelivr's copy of libretro's GitHub repositories, named after the console with underscores for spaces
		repository := ""
		if len(parts) > 2 {
			if decoded, err := decodeName(parts[2]); err == nil {
				repository, _, _ = strings.Cut(decoded, "@")
			}
		}
		segments = append([]string{strings.ReplaceAll(repository, "_", " ")}, parts[min(3, len(parts)):]...)
	}
	if len(segments) != 3 {
		return ""
	}
	names := make([]string, len(segments))
	for i, segment := range segments {
		name, err := decodeName(segment)
		if err != nil {
			return ""
		}
		names[i] = name
	}
	consoleName, folder, file := names[0], names[1], names[2]
	if consoleName == "" || !libretroArtFolder.MatchString(folder) || !strings.HasSuffix(strings.ToLower(file), ".png") ||
		!isUsableName(consoleName) || !isUsableName(file) {
		return ""
	}
	artworkPath, ok := config.StoragePath(artwork, filepath.Join(consoleName, folder, file))
	if !ok {
		return ""
	}
	return artworkPath
}

type cachePaths struct {
	file, meta, webP string
	// Where art was cached before the artwork folder was set, to be moved from the first time it's needed
	previous *cachePaths
}

func (c *Cache) paths(href string) cachePaths {
	sum := sha256.Sum256([]byte(href))
	key := hex.EncodeToString(sum[:])
	cached := cachePaths{file: filepath.Join(c.directory, key), meta: filepath.Join(c.directory, key+".json")}
	artworkPath := ArtworkPath(c.artwork, href)
	if artworkPath == "" {
		cached.webP = cached.file + ".webp"
		return cached
	}
	// Art keeps its readable name; what the cache notes about it, and its smaller WebP copy, are kept out of sight
	relative, _ := filepath.Rel(c.artwork, artworkPath)
	return cachePaths{
		file: artworkPath, meta: filepath.Join(c.artwork, ".meta", relative+".json"), previous: &cached,
		webP: filepath.Join(c.artwork, ".webp", relative+".webp"),
	}
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// movePreviouslyCached moves art cached before the artwork folder was set into it, with its note and WebP copy
func movePreviouslyCached(paths cachePaths) {
	if paths.previous == nil || !isFile(paths.previous.meta) {
		return
	}
	previous := paths.previous
	for _, move := range [][2]string{
		{previous.file, paths.file}, {previous.file + ".webp", paths.webP}, {previous.meta, paths.meta},
	} {
		if isFile(move[0]) && !isFile(move[1]) {
			files.MoveFile(move[0], move[1])
		}
	}
}

// isPinned tells whether an address is for a fixed version of its files, which never changes
func isPinned(href string) bool {
	if !strings.HasPrefix(href, CDNHost) {
		return false
	}
	path := pathname(href)
	for i := 0; i < len(path); i++ {
		if path[i] != '@' {
			continue
		}
		version, _, found := strings.Cut(path[i+1:], "/")
		if found && version != "" && version != "latest" {
			return true
		}
	}
	return false
}

func millis(t time.Time) float64 {
	return float64(t.UnixNano()) / 1e6
}

func (c *Cache) read(href string) (*Entry, error) {
	paths := c.paths(href)
	movePreviouslyCached(paths)
	text, readErr := os.ReadFile(paths.meta)
	info, statErr := os.Stat(paths.file)
	var file *Entry
	if statErr == nil && info.Mode().IsRegular() {
		file = &Entry{Path: paths.file, Size: info.Size(), WebPPath: paths.webP}
	}
	var noted *note
	if readErr == nil {
		noted = &note{}
		if err := json.Unmarshal(text, noted); err != nil {
			return nil, err
		}
	}
	// Art in the artwork folder that wasn't downloaded there was put there by hand, and is used whatever the cache knew
	// before, even that libretro has none
	if paths.previous != nil && file != nil && (noted == nil || noted.Status != 200) {
		file.ContentType, file.Status, file.Time = "image/png", 200, millis(info.ModTime())
		return file, nil
	}
	if noted == nil {
		return nil, nil
	}
	if noted.Status == 404 && file == nil {
		age := time.Duration((millis(time.Now()) - noted.Time) * float64(time.Millisecond))
		return &Entry{
			ContentType: noted.ContentType, Path: paths.file, Stale: c.Recheck > 0 && !isPinned(href) && age >= c.Recheck, Status: 404,
			Time: noted.Time, WebPPath: paths.webP,
		}, nil
	}
	if file == nil {
		// An image kept only as its WebP copy (CDN_KEEP_ORIGINALS=false)
		if noted.Status == 200 && isWebPSource(noted.ContentType) {
			if info, err := os.Stat(paths.webP); err == nil && info.Mode().IsRegular() {
				return &Entry{
					ContentType: "image/webp", Path: paths.webP, Size: info.Size(), Status: 200, Time: noted.Time,
					WebPPath: paths.webP,
				}, nil
			}
		}
		return nil, nil
	}
	file.ContentType, file.Status, file.Time = noted.ContentType, 200, noted.Time
	return file, nil
}

// upstreamError is an error answer from the CDN, as opposed to the CDN being unreachable
type upstreamError struct{ message string }

func (e *upstreamError) Error() string { return e.message }

// isFileSystemError tells whether the error is a file that couldn't be written here, which says nothing about whether
// the CDN can be reached
func isFileSystemError(err error) bool {
	var pathError *fs.PathError
	var linkError *os.LinkError
	return errors.As(err, &pathError) || errors.As(err, &linkError)
}

// writeNote writes what the cache notes about a file, under a temporary name first so it's never read half-written
func writeNote(path string, noted note) error {
	content, err := json.Marshal(struct {
		ContentType string `json:"contentType"`
		Status      int    `json:"status"`
		Time        int64  `json:"time"`
	}{noted.ContentType, noted.Status, int64(noted.Time)})
	if err != nil {
		return err
	}
	partial := path + "." + ids.New() + ".partial"
	defer os.Remove(partial)
	if err := os.WriteFile(partial, content, 0o644); err != nil {
		return err
	}
	return os.Rename(partial, path)
}

// downloads is how many downloads may run at once, so many requests for files not kept yet can't start more
var downloads = make(chan struct{}, 8)

func (c *Cache) download(href string) error {
	downloads <- struct{}{}
	defer func() { <-downloads }()
	paths := c.paths(href)
	if err := os.MkdirAll(filepath.Dir(paths.file), 0o777); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(paths.meta), 0o777); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeoutCause(context.Background(), fetchTimeout, fmt.Errorf("Timed out fetching %s", href))
	defer cancel()
	headers := time.AfterFunc(headersTimeout, cancel)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, href, nil)
	if err != nil {
		return err
	}
	response, err := c.client.Do(request)
	headers.Stop()
	if err != nil {
		var urlError *url.Error
		if errors.As(err, &urlError) {
			return fmt.Errorf("No response from %s: %w", href, urlError.Err)
		}
		return err
	}
	defer response.Body.Close()
	now := millis(time.Now())
	// A file that isn't there is remembered as missing. Another refusal (403, or 429 when there were too many requests)
	// says nothing about the file, and is tried again next time
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
		return writeNote(paths.meta, note{Status: 404, Time: now})
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return &upstreamError{fmt.Sprintf("Failed to fetch %s: %d", href, response.StatusCode)}
	}

	partial := paths.file + "." + ids.New() + ".partial"
	defer os.Remove(partial)
	output, err := os.Create(partial)
	if err != nil {
		return err
	}
	written, err := io.Copy(output, io.LimitReader(response.Body, maxDownloadSize+1))
	if err != nil {
		output.Close()
		return err
	}
	if written > maxDownloadSize {
		output.Close()
		return &upstreamError{fmt.Sprintf("Not keeping %s: larger than %d bytes", href, maxDownloadSize)}
	}
	if err := errors.Join(output.Sync(), output.Close()); err != nil {
		return err
	}
	if err := os.Rename(partial, paths.file); err != nil {
		return err
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if err := writeNote(paths.meta, note{ContentType: contentType, Status: 200, Time: millis(time.Now())}); err != nil {
		return err
	}
	if !c.KeepOriginals && isWebPSource(contentType) {
		c.dropOriginal(paths.file, paths.webP)
	}
	return nil
}

// once runs work for key, or waits for the run already under way and takes its result. A run that panics (in the image
// decoder, say) is an error for everyone waiting on it, and the next request tries again
func (c *Cache) once(calls map[string]*call, key string, work func() (string, error)) (string, error) {
	c.mutex.Lock()
	pending, found := calls[key]
	if found {
		c.mutex.Unlock()
		<-pending.done
		return pending.result, pending.err
	}
	pending = &call{done: make(chan struct{})}
	calls[key] = pending
	c.mutex.Unlock()
	defer func() {
		if recovered := recover(); recovered != nil {
			pending.result, pending.err = "", fmt.Errorf("%s: %v", key, recovered)
		}
		c.mutex.Lock()
		delete(calls, key)
		c.mutex.Unlock()
		close(pending.done)
	}()
	pending.result, pending.err = work()
	return pending.result, pending.err
}

// File is the cached file for an address, downloaded first if need be; requests for it at the same time share one
// download. A file older than maxAge (when above zero) is downloaded again, as is one last found missing long ago.
// When the CDN can't be reached, what the cache had is used, even that the file doesn't exist. Offline, only what the
// cache has is used. Nil for a file the cache doesn't have
func (c *Cache) File(href string, maxAge time.Duration, offline bool) (*Entry, error) {
	cached, err := c.read(href)
	if err != nil {
		return nil, err
	}
	old := maxAge > 0 && cached != nil && cached.Status == 200 &&
		millis(time.Now())-cached.Time > float64(maxAge.Milliseconds())
	if cached != nil && (!cached.Stale && !old || offline) {
		return cached, nil
	}
	if offline {
		return nil, nil
	}
	parsed, err := url.Parse(href)
	if err != nil {
		return nil, err
	}
	host := parsed.Host
	c.mutex.Lock()
	until := c.unreachable[host]
	c.mutex.Unlock()
	if until.After(time.Now()) {
		if cached != nil {
			return cached, nil
		}
		return nil, fmt.Errorf("%s is unreachable", host)
	}
	if _, err := c.once(c.downloads, href, func() (string, error) { return "", c.download(href) }); err != nil {
		var upstream *upstreamError
		if !errors.As(err, &upstream) && !isFileSystemError(err) {
			c.mutex.Lock()
			c.unreachable[host] = time.Now().Add(unreachableBackoff)
			c.mutex.Unlock()
		}
		if cached != nil {
			return cached, nil
		}
		return nil, err
	}
	c.mutex.Lock()
	delete(c.unreachable, host)
	c.mutex.Unlock()
	return c.read(href)
}

// Status tells whether the cache has a file (200), knows it doesn't exist upstream (404), or has yet to look for it
// (0). A file last found missing long ago is looked for again, so it counts as not looked for, unless offline
func (c *Cache) Status(href string, offline bool) (int, error) {
	cached, err := c.read(href)
	if err != nil || cached == nil || cached.Stale && !offline {
		return 0, err
	}
	if cached.Status == 200 {
		return 200, nil
	}
	return 404, nil
}
