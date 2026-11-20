package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Without Sec-Fetch-Site, as from an older browser, a request is from another site when its Origin is another host
func TestFromAnotherSite(t *testing.T) {
	for _, test := range []struct {
		name                       string
		fetchSite, origin, forward string
		want                       bool
	}{
		{name: "Sec-Fetch-Site same-origin", fetchSite: "same-origin", origin: "https://evil.example"},
		{name: "Sec-Fetch-Site cross-site", fetchSite: "cross-site", want: true},
		{name: "Sec-Fetch-Site same-site", fetchSite: "same-site", want: true},
		{name: "neither, as from curl"},
		{name: "Origin of this host", origin: "http://games.example"},
		{name: "Origin of this host, other case", origin: "http://GAMES.example"},
		{name: "Origin of another host", origin: "https://evil.example", want: true},
		{name: "Origin of a sibling subdomain", origin: "http://other.games.example", want: true},
		{name: "null Origin", origin: "null", want: true},
		{name: "Origin of the proxy's host", origin: "https://public.example", forward: "public.example"},
	} {
		request := httptest.NewRequest(http.MethodPost, "http://games.example/api/v1/favorites", nil)
		if test.fetchSite != "" {
			request.Header.Set("Sec-Fetch-Site", test.fetchSite)
		}
		if test.origin != "" {
			request.Header.Set("Origin", test.origin)
		}
		if test.forward != "" {
			request.Header.Set("X-Forwarded-Host", test.forward)
		}
		if got := fromAnotherSite(request); got != test.want {
			t.Errorf("%s: %v", test.name, got)
		}
	}
}

// The app's pages may be framed only where FRAME_ANCESTORS says, the app itself by default
func TestFrameAncestors(t *testing.T) {
	root := t.TempDir()
	html := `<script type="module" src="/assets/manifest-abc123.js"></script>`
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(html), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ setting, csp, frameOptions string }{
		{"'self'", "frame-ancestors 'self'", "SAMEORIGIN"},
		{"'self' https://dashboard.example", "frame-ancestors 'self' https://dashboard.example", ""},
		{"", "", ""},
	} {
		page, _, err := loadPage(root)
		if err != nil {
			t.Fatal(err)
		}
		page.frameAncestors = test.setting
		recorder := httptest.NewRecorder()
		page.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/library", nil))
		header := recorder.Header()
		if header.Get("Content-Security-Policy") != test.csp || header.Get("X-Frame-Options") != test.frameOptions {
			t.Errorf("%q: %q, %q", test.setting, header.Get("Content-Security-Policy"), header.Get("X-Frame-Options"))
		}
	}
}
