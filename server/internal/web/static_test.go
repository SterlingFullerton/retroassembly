package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// How long a browser keeps each kind of the app's own files
func TestStaticFilesCaching(t *testing.T) {
	root := t.TempDir()
	kept := "public, immutable, max-age=31536000"
	cases := map[string]string{
		"/assets/entry-AbCd1234.js":                 kept,
		"/cores/retroarch-1.22.2/mgba_libretro.zip": kept,
		"/assets/platforms/icons/psp.png":           "public, max-age=86400",
		"/assets/shaders/original.png":              "public, max-age=86400",
		"/favicon.png":                              "no-cache",
		"/cores/notes.txt":                          "no-cache",
	}
	for urlPath := range cases {
		filePath := filepath.Join(root, filepath.FromSlash(urlPath))
		if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filePath, []byte("content"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	handler := staticFiles(root, http.NotFoundHandler())
	for urlPath, want := range cases {
		answer := httptest.NewRecorder()
		handler.ServeHTTP(answer, httptest.NewRequest(http.MethodGet, urlPath, nil))
		if got := answer.Header().Get("Cache-Control"); answer.Code != http.StatusOK || got != want {
			t.Errorf("%s: %d, Cache-Control %q, want %q", urlPath, answer.Code, got, want)
		}
	}
}
