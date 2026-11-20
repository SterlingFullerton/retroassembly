package web

import (
	"errors"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

func init() {
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// Built files named after a fingerprint of their contents (/assets/name-hash.ext) never change, so browsers can keep
// them for good. Files at a fixed address (the favicon, the manifest, artwork) can change in a new build, so browsers
// keep them but check each time
var fingerprintedPath = regexp.MustCompile(`^/assets/[^/]+-[\w-]{8}\.\w+$`)

// The compressed copies the build writes beside its files, in the order they're preferred
var encodings = []struct{ name, extension string }{{"br", ".br"}, {"zstd", ".zst"}, {"gzip", ".gz"}}

func accepts(r *http.Request, encoding string) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, _, _ := strings.Cut(strings.TrimSpace(part), ";")
		if name == encoding {
			return true
		}
	}
	return false
}

func regularFile(filePath string) (os.FileInfo, bool) {
	info, err := os.Stat(filePath)
	return info, err == nil && info.Mode().IsRegular()
}

// staticFiles serves the built browser app's files from root, a compressed copy when the browser takes one, and
// passes anything else on to next
func staticFiles(root string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		urlPath := path.Clean("/" + r.URL.Path)
		filePath := filepath.Join(root, filepath.FromSlash(urlPath))
		info, ok := regularFile(filePath)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}

		header := w.Header()
		if fingerprintedPath.MatchString(urlPath) {
			header.Set("Cache-Control", "public, immutable, max-age=31536000")
		} else {
			header.Set("Cache-Control", "no-cache")
		}
		contentType := mime.TypeByExtension(path.Ext(urlPath))
		if contentType != "" {
			header.Set("Content-Type", contentType)
		}

		served := filePath
		for _, encoding := range encodings {
			if !accepts(r, encoding.name) {
				continue
			}
			if _, ok := regularFile(filePath + encoding.extension); ok {
				served = filePath + encoding.extension
				header.Set("Content-Encoding", encoding.name)
				header.Add("Vary", "Accept-Encoding")
				break
			}
		}
		file, err := os.Open(served)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		defer file.Close()
		// Answers If-Modified-Since with 304, by the original file's time
		http.ServeContent(w, r, urlPath, info.ModTime(), file)
	})
}

// page is index.html, the one page every page address is answered with, with its compressed copies
type page struct {
	encoded map[string][]byte
	// The sites that may show the app in a frame (FRAME_ANCESTORS), or none set for any
	frameAncestors string
	html           []byte
}

var manifestPattern = regexp.MustCompile(`/assets/manifest-([\da-f]+)\.js`)

func loadPage(root string) (*page, string, error) {
	html, err := os.ReadFile(filepath.Join(root, "index.html"))
	if err != nil {
		return nil, "", err
	}
	// The build's version is in the name of the manifest React Router writes, which index.html loads
	match := manifestPattern.FindSubmatch(html)
	if match == nil {
		return nil, "", errors.New("no build version found in index.html")
	}
	p := &page{encoded: map[string][]byte{}, html: html}
	for _, encoding := range encodings {
		if content, err := os.ReadFile(filepath.Join(root, "index.html"+encoding.extension)); err == nil {
			p.encoded[encoding.name] = content
		}
	}
	return p, string(match[1]), nil
}

func (p *page) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("Cache-Control", "no-cache")
	header.Set("Content-Type", "text/html; charset=UTF-8")
	header.Add("Vary", "Accept-Encoding")
	header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	// Shown in a frame only where it's allowed, so a page elsewhere can't lay the library under its own and have it
	// clicked unseen
	if p.frameAncestors != "" {
		header.Set("Content-Security-Policy", "frame-ancestors "+p.frameAncestors)
		if p.frameAncestors == "'self'" {
			header.Set("X-Frame-Options", "SAMEORIGIN")
		}
	}
	body := p.html
	for _, encoding := range encodings {
		if content, ok := p.encoded[encoding.name]; ok && accepts(r, encoding.name) {
			header.Set("Content-Encoding", encoding.name)
			body = content
			break
		}
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}
