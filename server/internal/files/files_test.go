package files

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKindOf(t *testing.T) {
	cases := map[string]Kind{
		"roms/nes/abc.nes":       {Name: "rom"},
		"bioses/psx/abc.bin":     {Name: "bios"},
		"attachments/u1/nes/x":   {Name: "attachment", UserID: "u1"},
		"states/u1/nes/x.state":  {Name: "state", UserID: "u1"},
		"game-saves/u1/nes/x.sr": {Name: "game-save", UserID: "u1"},
	}
	for id, want := range cases {
		if got, ok := KindOf(id); !ok || got != want {
			t.Errorf("KindOf(%q) = %v, %v; want %v", id, got, ok, want)
		}
	}
	for _, id := range []string{"roms/nes", "roms//x", "roms/../x", "states/./x", `roms\nes\x`, "other/a/b", ""} {
		if _, ok := KindOf(id); ok {
			t.Errorf("KindOf(%q) should not be a stored file", id)
		}
	}
}

// The digests the Node server's getFilePartialDigest gives the same files
func TestPartialDigest(t *testing.T) {
	pattern := make([]byte, 3000)
	for i := range pattern {
		pattern[i] = byte(i % 251)
	}
	cases := map[string]struct {
		content []byte
		want    string
	}{
		"over 2 KB":       {pattern, "731ee4d7aa8aee4c"},
		"under 1 KB":      {[]byte("small bios"), "99b0c2e3febbe798"},
		"between 1 and 2": {make([]byte, 1500), "12636ad34eee18cd"},
	}
	for name, test := range cases {
		got, err := PartialDigest(bytes.NewReader(test.content), int64(len(test.content)))
		if err != nil || got != test.want {
			t.Errorf("%s: %q, %v; want %q", name, got, err, test.want)
		}
	}
}

func TestPut(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "bioses", "psx", "abc.bin")
	if err := Put(filePath, strings.NewReader("bios")); err != nil {
		t.Fatal(err)
	}
	if content, err := os.ReadFile(filePath); err != nil || string(content) != "bios" {
		t.Fatalf("%q, %v", content, err)
	}
	if left, _ := filepath.Glob(filePath + ".*.partial"); len(left) > 0 {
		t.Fatalf("partial files left behind: %v", left)
	}
}

func TestParseRange(t *testing.T) {
	cases := []struct {
		header         string
		offset, length int64
		ok             bool
	}{
		{"bytes=0-99", 0, 100, true},
		{"bytes=100-", 100, -1, true},
		{"bytes=5-4", 0, 0, false},
		{"bytes=0-1,5-6", 0, 0, false},
		{"items=0-1", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, test := range cases {
		offset, length, ok := parseRange(test.header)
		if offset != test.offset || length != test.length || ok != test.ok {
			t.Errorf("parseRange(%q) = %d, %d, %v", test.header, offset, length, ok)
		}
	}
}

func TestServe(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "game.nes")
	if err := os.WriteFile(filePath, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}

	whole := httptest.NewRecorder()
	Serve(whole, httptest.NewRequest(http.MethodGet, "/", nil), "roms/nes/game.nes", filePath)
	if whole.Code != http.StatusOK || whole.Body.String() != "0123456789" {
		t.Fatalf("whole file: %d %q", whole.Code, whole.Body.String())
	}
	if got := whole.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Errorf("a game is sent as the Node server sends it, got %q", got)
	}

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Range", "bytes=2-4")
	part := httptest.NewRecorder()
	Serve(part, request, "roms/nes/game.nes", filePath)
	if part.Code != http.StatusPartialContent || part.Body.String() != "234" || part.Header().Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("range: %d %q %q", part.Code, part.Body.String(), part.Header().Get("Content-Range"))
	}

	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Range", "bytes=20-")
	past := httptest.NewRecorder()
	Serve(past, request, "roms/nes/game.nes", filePath)
	if past.Code != http.StatusOK || past.Body.String() != "0123456789" {
		t.Fatalf("a range past the end is answered with the whole file: %d", past.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("If-None-Match", whole.Header().Get("ETag"))
	cached := httptest.NewRecorder()
	Serve(cached, request, "roms/nes/game.nes", filePath)
	if cached.Code != http.StatusNotModified || cached.Body.Len() != 0 {
		t.Fatalf("same ETag: %d", cached.Code)
	}

	missing := httptest.NewRecorder()
	Serve(missing, httptest.NewRequest(http.MethodGet, "/", nil), "roms/nes/x.nes", filePath+".missing")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing file: %d", missing.Code)
	}
}
