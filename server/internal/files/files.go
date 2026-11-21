// Package files decides who may read a stored file and sends it, as src/api/routes/library/files.ts does.
package files

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"retroassembly/server/internal/db"
)

// Kind is what a stored file is, read from its id, which says who it belongs to:
//   - roms/<platform>/<md5><ext>: a ROM, kept once however many users upload it, so it belongs to whoever has it
//   - bioses/<platform>/<md5><ext>: a BIOS, likewise kept once, belonging to whoever has it in their settings
//   - attachments/<user id>/...: a game's box art or screenshots, added by that user to their library
//   - states/<user id>/...: that user's saved state and its thumbnail
//   - game-saves/<user id>/...: that user's in-game saves
type Kind struct {
	Name   string
	UserID string
}

// KindOf is the kind of a file id, or false for an id with an empty, "." or ".." part, a backslash, or another first
// folder, which isn't a file this app stores
func KindOf(id string) (Kind, bool) {
	if strings.Contains(id, `\`) {
		return Kind{}, false
	}
	parts := strings.Split(id, "/")
	if len(parts) < 3 {
		return Kind{}, false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return Kind{}, false
		}
	}
	switch parts[0] {
	case "attachments":
		return Kind{Name: "attachment", UserID: parts[1]}, true
	case "bioses":
		return Kind{Name: "bios"}, true
	case "game-saves":
		return Kind{Name: "game-save", UserID: parts[1]}, true
	case "roms":
		return Kind{Name: "rom"}, true
	case "states":
		return Kind{Name: "state", UserID: parts[1]}, true
	}
	return Kind{}, false
}

// Reader is who asks for a file: the user, and whose library they see
type Reader struct {
	LibraryOwnerID string
	UserID         string
}

// The BIOS files in a user's settings. The defaults have none, so the stored settings are all there is to read
func biosFileIDs(ctx context.Context, database *sql.DB, userID string) ([]string, error) {
	var emulator sql.NullString
	err := database.QueryRowContext(ctx,
		`SELECT emulator FROM user_preferences WHERE user_id = ? AND status = ? LIMIT 1`, userID, db.StatusNormal,
	).Scan(&emulator)
	if errors.Is(err, sql.ErrNoRows) || !emulator.Valid {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var settings struct {
		Platform map[string]*struct {
			Bioses []struct {
				FileID string `json:"fileId"`
			} `json:"bioses"`
		} `json:"platform"`
	}
	if err := json.Unmarshal([]byte(emulator.String), &settings); err != nil {
		return nil, err
	}
	var fileIDs []string
	for _, platform := range settings.Platform {
		if platform == nil {
			continue
		}
		for _, bios := range platform.Bioses {
			fileIDs = append(fileIDs, bios.FileID)
		}
	}
	return fileIDs, nil
}

// CanRead tells whether the reader may read a stored file: their own, or, for a user who shares another's library,
// that library's ROMs, box art and BIOS files. Save states and game saves are each user's own
func CanRead(ctx context.Context, database *sql.DB, reader Reader, id string) (bool, error) {
	kind, ok := KindOf(id)
	if !ok {
		return false, nil
	}
	switch kind.Name {
	case "attachment":
		return kind.UserID == reader.UserID || kind.UserID == reader.LibraryOwnerID, nil
	case "bios":
		owners := []string{reader.UserID}
		if reader.LibraryOwnerID != "" && reader.LibraryOwnerID != reader.UserID {
			owners = append(owners, reader.LibraryOwnerID)
		}
		for _, owner := range owners {
			fileIDs, err := biosFileIDs(ctx, database, owner)
			if err != nil {
				return false, err
			}
			if slices.Contains(fileIDs, id) {
				return true, nil
			}
		}
		return false, nil
	case "rom":
		var romID string
		err := database.QueryRowContext(ctx,
			`SELECT id FROM roms WHERE file_id = ? AND user_id = ? AND status = ? LIMIT 1`,
			id, reader.LibraryOwnerID, db.StatusNormal,
		).Scan(&romID)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	case "game-save", "state":
		return kind.UserID == reader.UserID, nil
	}
	return false, nil
}

var mimeTypes = map[string]string{
	".avi":  "video/x-msvideo",
	".gif":  "image/gif",
	".jpeg": "image/jpeg",
	".jpg":  "image/jpeg",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".mp4":  "video/mp4",
	".ogv":  "video/ogg",
	".pdf":  "application/pdf",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".webm": "video/webm",
	".webp": "image/webp",
}

var rangePattern = regexp.MustCompile(`^bytes=(\d+)-(\d*)$`)

// A single "bytes=start-end" or "bytes=start-" range; anything else is answered with the whole file
func parseRange(header string) (offset int64, length int64, ok bool) {
	match := rangePattern.FindStringSubmatch(header)
	if match == nil {
		return 0, 0, false
	}
	offset, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	if match[2] == "" {
		return offset, -1, true
	}
	end, err := strconv.ParseInt(match[2], 10, 64)
	if err != nil || end < offset {
		return 0, 0, false
	}
	return offset, end - offset + 1, true
}

// Serve sends the file at filePath, or the part a range asks for, with an ETag that changes only when the file does.
// A stored file is only ever data: one that holds a script, such as an uploaded SVG, can't run it on this site when
// opened on its own, and a browser never guesses a type the file wasn't given
func Serve(w http.ResponseWriter, r *http.Request, id, filePath string) {
	file, err := os.Open(filePath)
	if errors.Is(err, os.ErrNotExist) {
		http.Error(w, "404 Not Found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, "404 Not Found", http.StatusNotFound)
		return
	}
	size := info.Size()
	etag := fmt.Sprintf(`"%s-%s"`, strconv.FormatInt(size, 36), strconv.FormatInt(info.ModTime().UnixMilli(), 36))
	header := w.Header()
	if r.Header.Get("If-None-Match") == etag {
		header.Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// Any other kind, a game or a save, is sent as plain bytes, and never guessed from its own: not as text, which a
	// proxy in front would compress as it goes, slowing a game that's compressed already and hiding its size
	contentType, ok := mimeTypes[strings.ToLower(path.Ext(id))]
	if !ok {
		contentType = "application/octet-stream"
	}
	header.Set("Content-Type", contentType)
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("ETag", etag)
	header.Set("Accept-Ranges", "bytes")
	// What's at a file's id never changes: a game's and a BIOS's is named after its contents, and a save's or a
	// picture's has an id of its own. So the browser that fetched it keeps it, without asking again; no proxy does
	header.Set("Cache-Control", "private, max-age=31536000, immutable")

	start, end := int64(0), size-1
	status := http.StatusOK
	if offset, length, ok := parseRange(r.Header.Get("Range")); ok && offset < size {
		// Past the end, or with no end, it's up to the file's end. Clamped before adding, as a huge end would overflow
		if length < 0 || length > size-offset {
			length = size - offset
		}
		start, end = offset, offset+length-1
		header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		status = http.StatusPartialContent
	}
	header.Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return
	}
	io.CopyN(w, file, end-start+1)
}
