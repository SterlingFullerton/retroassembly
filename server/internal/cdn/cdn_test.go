package cdn

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/shared"
)

type fixtureRom struct {
	FileName        string          `json:"fileName"`
	Platform        string          `json:"platform"`
	RawGameMetadata json.RawMessage `json:"rawGameMetadata"`
}

func (r fixtureRom) rom() Rom {
	return Rom{FileName: r.FileName, Platform: r.Platform, Metadata: ParseMetadata(r.RawGameMetadata)}
}

type fixtures struct {
	Artwork []struct {
		Result *string `json:"result"`
		URL    string  `json:"url"`
	} `json:"artwork"`
	Candidates []struct {
		Result []string   `json:"result"`
		Rom    fixtureRom `json:"rom"`
	} `json:"candidates"`
	CoverLists []struct {
		Folder string `json:"folder"`
		HTML   string `json:"html"`
	} `json:"coverLists"`
	Matched []struct {
		Result *string    `json:"result"`
		Rom    fixtureRom `json:"rom"`
	} `json:"matched"`
	Regions []struct {
		Name   string   `json:"name"`
		Result []string `json:"result"`
	} `json:"regions"`
	Targets []struct {
		CachePath string  `json:"cachePath"`
		Error     string  `json:"error"`
		Result    *Target `json:"result"`
	} `json:"targets"`
	TitleKeys []struct {
		Name   string `json:"name"`
		Result string `json:"result"`
	} `json:"titleKeys"`
}

func (t *Target) UnmarshalJSON(content []byte) error {
	var target struct {
		RequiresLogin bool   `json:"requiresLogin"`
		URL           string `json:"url"`
	}
	err := json.Unmarshal(content, &target)
	*t = Target{RequiresLogin: target.RequiresLogin, URL: target.URL}
	return err
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "typescript.json"))
	if err != nil {
		t.Fatal(err)
	}
	var loaded fixtures
	if err := json.Unmarshal(content, &loaded); err != nil {
		t.Fatal(err)
	}
	return loaded
}

func loadData(t *testing.T) *Data {
	t.Helper()
	data, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	return &Data{data.CDN}
}

func orNull(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func show(value *string) string {
	if value == nil {
		return "null"
	}
	return *value
}

// The answers the TypeScript code gives (scripts/go-test-fixtures.ts)
func TestMatchesTypeScript(t *testing.T) {
	loaded, data := loadFixtures(t), loadData(t)
	for _, test := range loaded.Targets {
		target, err := data.ResolveTarget(test.CachePath)
		if test.Error != "" {
			if !errors.Is(err, ErrURIMalformed) {
				t.Errorf("target %q: no error, %v", test.CachePath, target)
			}
			continue
		}
		if err != nil || !reflect.DeepEqual(target, test.Result) {
			t.Errorf("target %q: %+v %v, want %+v", test.CachePath, target, err, test.Result)
		}
	}
	for _, test := range loaded.Candidates {
		if got := data.Candidates(test.Rom.rom()); !reflect.DeepEqual(got, test.Result) {
			t.Errorf("candidates of %q:\n%q\nwant\n%q", test.Rom.FileName, got, test.Result)
		}
	}
	for _, test := range loaded.Artwork {
		if got := orNull(ArtworkPath("/artwork", test.URL)); show(got) != show(test.Result) {
			t.Errorf("artwork %q: %s, want %s", test.URL, show(got), show(test.Result))
		}
	}
	for _, test := range loaded.TitleKeys {
		if got := TitleKey(test.Name); got != test.Result {
			t.Errorf("title of %q: %q, want %q", test.Name, got, test.Result)
		}
	}
	for _, test := range loaded.Regions {
		if got := Regions(test.Name); !reflect.DeepEqual(got, test.Result) && len(got)+len(test.Result) > 0 {
			t.Errorf("regions of %q: %q, want %q", test.Name, got, test.Result)
		}
	}

	// libretro's box art matched by title, from its lists in the cache
	directory := t.TempDir()
	cache := New(data, config.Directories{Cache: directory}, true)
	for _, list := range loaded.CoverLists {
		sum := sha256.Sum256([]byte(CoverListURL(list.Folder)))
		key := filepath.Join(directory, "cdn", hex.EncodeToString(sum[:]))
		os.MkdirAll(filepath.Dir(key), 0o755)
		os.WriteFile(key, []byte(list.HTML), 0o644)
		os.WriteFile(key+".json", []byte(fmt.Sprintf(`{"contentType":"text/html","status":200,"time":%d}`, time.Now().UnixMilli())), 0o644)
	}
	for _, test := range loaded.Matched {
		got, err := cache.MatchedCover(test.Rom.rom(), true)
		if err != nil || show(orNull(got)) != show(test.Result) {
			t.Errorf("cover matched for %q: %s %v, want %s", test.Rom.FileName, got, err, show(test.Result))
		}
	}
}

func TestResolve(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"a b/c", "https://h.example/a%20b/c"},
		{"a/./b/../c", "https://h.example/a/c"},
		{"a/..", "https://h.example/"},
		{`a\b`, "https://h.example/a/b"},
		{`a#b\c d`, `https://h.example/a#b\c%20d`},
		{"a?b c'd", "https://h.example/a?b%20c%27d"},
		{"%zz/100%", "https://h.example/%zz/100%"},
		{"é", "https://h.example/%C3%A9"},
	} {
		if got, ok := resolve("https://h.example/", test.input); !ok || got != test.want {
			t.Errorf("%q: %q, want %q", test.input, got, test.want)
		}
	}
	for _, input := range []string{"//evil.example/x", `\\evil.example`, "http://evil.example", "javascript:x"} {
		if got, ok := resolve("https://h.example/", input); ok {
			t.Errorf("%q taken for %q", input, got)
		}
	}
}

func pngOf(t *testing.T) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for x := range 64 {
		for y := range 64 {
			picture.Set(x, y, color.RGBA{uint8(x * 4), uint8(y * 4), 128, 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestFile(t *testing.T) {
	picture := pngOf(t)
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch r.URL.Path {
		case "/ok.png":
			w.Header().Set("Content-Type", "image/png")
			time.Sleep(50 * time.Millisecond)
			w.Write(picture)
		case "/broken":
			w.WriteHeader(http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	directory := t.TempDir()
	cache := New(loadData(t), config.Directories{Cache: directory}, false)
	cache.client = upstream.Client()

	// Several asking at once share one download
	results := make(chan *Entry, 3)
	for range 3 {
		go func() {
			entry, err := cache.File(upstream.URL+"/ok.png", 0, false)
			if err != nil {
				t.Error(err)
			}
			results <- entry
		}()
	}
	for range 3 {
		if entry := <-results; entry == nil || entry.Status != 200 || entry.ContentType != "image/png" || entry.Size != int64(len(picture)) {
			t.Fatalf("%+v", entry)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("%d downloads", requests.Load())
	}
	if status, _ := cache.Status(upstream.URL+"/ok.png", false); status != 200 {
		t.Fatalf("status %d", status)
	}

	// A file that doesn't exist is noted as missing, and isn't asked for again
	if entry, err := cache.File(upstream.URL+"/missing.png", 0, false); err != nil || entry == nil || entry.Status != 404 {
		t.Fatalf("%+v %v", entry, err)
	}
	before := requests.Load()
	if status, _ := cache.Status(upstream.URL+"/missing.png", false); status != 404 || requests.Load() != before {
		t.Fatal("missing file asked for again")
	}
	// An error answer is the CDN's, and doesn't make it unreachable
	if _, err := cache.File(upstream.URL+"/broken", 0, false); err == nil {
		t.Fatal("no error")
	}
	if entry, _ := cache.File(upstream.URL+"/missing2.png", 0, false); entry == nil || entry.Status != 404 {
		t.Fatal("host taken for unreachable after an error answer")
	}

	// Offline, only what's in the cache
	if entry, err := cache.File(upstream.URL+"/other.png", 0, true); entry != nil || err != nil {
		t.Fatalf("offline: %+v %v", entry, err)
	}

	// A WebP copy, made once
	entry, _ := cache.File(upstream.URL+"/ok.png", 0, false)
	path, size := cache.WebPCopy(entry)
	if path == "" || size == 0 || !strings.HasSuffix(path, ".webp") {
		t.Fatalf("no WebP copy: %q", path)
	}
	header, _ := os.ReadFile(path)
	if !bytes.HasPrefix(header, []byte("RIFF")) || !bytes.Equal(header[8:12], []byte("WEBP")) {
		t.Fatal("not a WebP file")
	}
	info, _ := os.Stat(path)
	if again, _ := cache.WebPCopy(entry); again != path {
		t.Fatal("another copy")
	}
	if later, _ := os.Stat(path); !later.ModTime().Equal(info.ModTime()) {
		t.Fatal("copy made again")
	}
	if path, _ := cache.WebPCopy(&Entry{ContentType: "text/css", Path: entry.Path}); path != "" {
		t.Fatal("a copy of a stylesheet")
	}

	// A host that doesn't answer is skipped for a while, and what the cache has is used meanwhile
	upstream.Close()
	if entry, err := cache.File(upstream.URL+"/new.png", 0, false); entry != nil || err == nil {
		t.Fatal("no error for an unreachable host")
	}
	if _, err := cache.File(upstream.URL+"/new2.png", 0, false); err == nil || !strings.Contains(err.Error(), "unreachable") {
		t.Fatalf("not skipped: %v", err)
	}
	if entry, err := cache.File(upstream.URL+"/ok.png", time.Nanosecond, false); err != nil || entry == nil || entry.Status != 200 {
		t.Fatalf("cached file not used: %+v %v", entry, err)
	}
}

func TestArtworkFolder(t *testing.T) {
	data := loadData(t)
	cacheDirectory, artwork := t.TempDir(), t.TempDir()
	href := LibretroHost + "Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World).png"

	// Cached before the artwork folder was set: moved into it the first time it's asked for
	before := New(data, config.Directories{Cache: cacheDirectory}, true)
	old := before.paths(href)
	os.MkdirAll(filepath.Dir(old.file), 0o755)
	os.WriteFile(old.file, []byte("png"), 0o644)
	writeNote(old.meta, note{ContentType: "image/png", Status: 200, Time: 1})
	cache := New(data, config.Directories{Artwork: artwork, Cache: cacheDirectory}, true)
	entry, err := cache.File(href, 0, true)
	moved := filepath.Join(artwork, "Nintendo - Game Boy", "Named_Boxarts", "Tetris (World).png")
	if err != nil || entry == nil || entry.Path != moved || !isFile(moved) || isFile(old.file) {
		t.Fatalf("%+v %v", entry, err)
	}
	if !isFile(filepath.Join(artwork, ".meta", "Nintendo - Game Boy", "Named_Boxarts", "Tetris (World).png.json")) {
		t.Fatal("note not moved")
	}

	// Put there by hand, used even though the cache knew libretro has none
	byHand := LibretroHost + "Nintendo%20-%20Game%20Boy/Named_Snaps/Mine.png"
	paths := cache.paths(byHand)
	os.MkdirAll(filepath.Dir(paths.meta), 0o755)
	writeNote(paths.meta, note{Status: 404, Time: 1})
	if status, _ := cache.Status(byHand, true); status != 404 {
		t.Fatalf("status %d", status)
	}
	os.MkdirAll(filepath.Dir(paths.file), 0o755)
	os.WriteFile(paths.file, []byte("png"), 0o644)
	if entry, _ := cache.File(byHand, 0, true); entry == nil || entry.Status != 200 || entry.ContentType != "image/png" {
		t.Fatalf("%+v", entry)
	}
}

func TestStale(t *testing.T) {
	cache := New(loadData(t), config.Directories{Cache: t.TempDir()}, false)
	for _, test := range []struct {
		href  string
		stale bool
	}{
		{LibretroHost + "x/Named_Boxarts/a.png", true},
		{CDNHost + "gh/libretro/docs@35b22b41/x.png", false},
		{CDNHost + "gh/libretro/docs@latest/x.png", true},
	} {
		paths := cache.paths(test.href)
		os.MkdirAll(filepath.Dir(paths.meta), 0o755)
		writeNote(paths.meta, note{Status: 404, Time: millis(time.Now().Add(-31 * 24 * time.Hour))})
		entry, _ := cache.read(test.href)
		if entry == nil || entry.Stale != test.stale {
			t.Errorf("%s: %+v", test.href, entry)
		}
	}
}
