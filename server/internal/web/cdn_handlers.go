package web

import (
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"retroassembly/server/internal/cdn"
	"retroassembly/server/internal/library"
)

var acceptsWebP = regexp.MustCompile(`(?i)image/webp`)

// /cdn/ is answered outside the API, so its errors are text, as Hono writes an HTTPException's message, not JSON
const cdnErrorType = "text/plain;charset=UTF-8"

func writeText(w http.ResponseWriter, status int, contentType, message string) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	io.WriteString(w, message)
}

// GET /cdn/*: a file from the server's copy of CDN files, downloaded first if need be, as src/middlewares/cdn-cache.ts
// serves it
func (s *Server) cdnFile(w http.ResponseWriter, r *http.Request) {
	requestPath, _, _ := strings.Cut(r.RequestURI, "?")
	target, err := s.cdn.ResolveTarget(strings.TrimPrefix(requestPath, "/cdn/"))
	if err != nil {
		log.Println(err)
		writeText(w, http.StatusInternalServerError, "text/plain; charset=UTF-8", "Internal Server Error")
		return
	}
	if target == nil {
		writeText(w, http.StatusNotFound, cdnErrorType, "Not found")
		return
	}
	if target.RequiresLogin && stateOf(r).user == nil {
		writeText(w, http.StatusUnauthorized, cdnErrorType, "Unauthorized")
		return
	}

	header := w.Header()
	// The files come from elsewhere: an SVG or HTML among them must not run as a page of this site
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
	cached, err := s.cdn.File(target.URL, 0, s.cdn.Offline)
	if err != nil {
		log.Println(err)
		writeText(w, http.StatusBadGateway, cdnErrorType, "Failed to fetch the file from the CDN.")
		return
	}
	// Offline, a file not in the cache yet may arrive with the next prefetch, so the browser is told to ask again
	if cached == nil && s.cdn.Offline {
		header.Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if cached == nil || cached.Status == 404 {
		// Lets the browser skip files it already knows are missing, such as box art for games that have none
		header.Set("Cache-Control", "public, max-age=86400")
		w.WriteHeader(http.StatusNotFound)
		return
	}

	header.Set("Cache-Control", "public, max-age=31536000, immutable")
	path, contentType, size := cached.Path, cached.ContentType, cached.Size
	// Images are sent as a much smaller WebP copy to browsers that accept it, which is all current ones
	if acceptsWebP.MatchString(r.Header.Get("Accept")) {
		header.Set("Vary", "Accept")
		if copyPath, copySize := s.cdn.WebPCopy(cached); copyPath != "" {
			path, contentType, size = copyPath, "image/webp", copySize
		}
	}
	file, err := os.Open(path)
	if err != nil {
		log.Println(err)
		writeText(w, http.StatusInternalServerError, "text/plain; charset=UTF-8", "Internal Server Error")
		return
	}
	defer file.Close()
	header.Set("Content-Type", contentType)
	header.Set("Content-Length", strconv.FormatInt(size, 10))
	io.Copy(w, file)
}

// romForCovers is what a game's pictures are found from, out of a game as the API answers it
func romForCovers(rom library.Object) cdn.Rom {
	fileName, _ := rom.Get("fileName").(string)
	platform, _ := rom.Get("platform").(string)
	raw, _ := rom.Get("rawGameMetadata").(json.RawMessage)
	return cdn.Rom{FileName: fileName, Platform: platform, Metadata: cdn.ParseMetadata(raw)}
}

// withCovers notes on each game which of its pictures the server has (coverCandidates), so pages don't ask for ones
// that don't exist, as addCoverCandidates does. Only the server's CDN cache knows which exist, so without it the games
// are left as they are and pages try them all
func (s *Server) withCovers(roms []library.Object) error {
	if s.cdn == nil {
		return nil
	}
	var (
		group    sync.WaitGroup
		mutex    sync.Mutex
		firstErr error
	)
	for i := range roms {
		group.Go(func() {
			candidates, err := s.cdn.CoverCandidates(romForCovers(roms[i]))
			if err != nil {
				mutex.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mutex.Unlock()
				return
			}
			roms[i].Set("coverCandidates", candidates)
		})
	}
	group.Wait()
	return firstErr
}

// allRoms is every game in the server, every user's, for the prefetch
func (s *Server) allRoms() ([]cdn.Rom, error) {
	rows, err := s.database.Query(`SELECT file_name, platform, raw_game_metadata FROM roms WHERE status = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roms []cdn.Rom
	for rows.Next() {
		var (
			fileName, platform sql.NullString
			metadata           []byte
		)
		if err := rows.Scan(&fileName, &platform, &metadata); err != nil {
			return nil, err
		}
		roms = append(roms, cdn.Rom{
			FileName: fileName.String, Platform: platform.String, Metadata: cdn.ParseMetadata(metadata),
		})
	}
	return roms, rows.Err()
}

// StartPrefetch downloads what RETROASSEMBLY_RUN_TIME_CDN_PREFETCH names into the CDN cache, in the background
func (s *Server) StartPrefetch() {
	if s.config.CDNPrefetch == "" {
		return
	}
	if s.cdn == nil {
		log.Println("RETROASSEMBLY_RUN_TIME_CDN_PREFETCH is ignored unless RETROASSEMBLY_RUN_TIME_CDN_CACHE=true")
		return
	}
	go func() {
		if _, err := s.cdn.Prefetch(s.config.CDNPrefetch, s.allRoms); err != nil {
			log.Println("Failed to prefetch CDN files", err)
		}
	}()
}
