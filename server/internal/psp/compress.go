package psp

import (
	"database/sql"
	"errors"
	"log"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/files"
)

// An uploaded ISO is playable straight away and compressed afterwards, in the background, one game at a time

// An ISO stays this long after its CSO replaces it, for pages that loaded before the swap and are about to download it
const isoKeptFor = 10 * time.Minute

var isoExtension = regexp.MustCompile(`(?i)\.iso$`)

// Beside an ISO kept because compressing it saved nothing
const keptMarker = ".uncompressed"

// CsoFileID is the CSO a PSP ISO's file id is compressed to
func CsoFileID(isoFileID string) string {
	return isoExtension.ReplaceAllString(isoFileID, ".cso")
}

// IsCompressible tells whether a game file is a PSP ISO the app compresses
func IsCompressible(platform, fileID string) bool {
	return platform == "psp" && isoExtension.MatchString(fileID)
}

// Compressor compresses PSP ISOs one at a time, and swaps each for its CSO once it's checked
type Compressor struct {
	Database *sql.DB
	// FilePath is where a stored file is on disk
	FilePath func(id string) (string, bool)

	mutex  sync.Mutex
	last   chan struct{}
	queued map[string]chan struct{}
	// ISOs replaced since the server started, removed by their own timer
	replaced map[string]bool
}

// Compress compresses a PSP ISO after any already waiting. The channel it returns is closed once it's done, or has
// failed and kept the ISO
func (c *Compressor) Compress(isoFileID string) <-chan struct{} {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if c.queued == nil {
		c.queued, c.replaced = map[string]chan struct{}{}, map[string]bool{}
	}
	if done, found := c.queued[isoFileID]; found {
		return done
	}
	previous, done := c.last, make(chan struct{})
	c.queued[isoFileID], c.last = done, done
	go func() {
		defer func() {
			// A disc it can't handle is left as it is, rather than taking the server down
			if failed := recover(); failed != nil {
				log.Printf("Couldn't compress %s, keeping the ISO: %v", isoFileID, failed)
			}
			c.mutex.Lock()
			delete(c.queued, isoFileID)
			c.mutex.Unlock()
			close(done)
		}()
		if previous != nil {
			<-previous
		}
		if err := c.compress(isoFileID); err != nil {
			log.Printf("Couldn't compress %s, keeping the ISO %v", isoFileID, err)
		}
	}()
	return done
}

func exists(filePath string) bool {
	_, err := os.Stat(filePath)
	return err == nil
}

func (c *Compressor) compress(isoFileID string) error {
	csoFileID := CsoFileID(isoFileID)
	isoPath, isoOK := c.FilePath(isoFileID)
	csoPath, csoOK := c.FilePath(csoFileID)
	if !isoOK || !csoOK || csoFileID == isoFileID || !exists(isoPath) || exists(isoPath+keptMarker) {
		return nil
	}
	// A CSO already there is from another upload of the same disc, or an earlier run stopped before the swap. It's
	// checked all the same: a disk that filled up, or a crash before it was written out, can have left it incomplete
	if exists(csoPath) {
		if err := Check(csoPath, isoPath); err != nil {
			log.Printf("Compressing %s again: the CSO there doesn't match it (%v)", isoFileID, err)
			os.Remove(csoPath)
		}
	}
	if !exists(csoPath) {
		started := time.Now()
		size, err := Compress(isoPath, csoPath, -1)
		if err != nil {
			return err
		}
		if err := Check(csoPath, isoPath); err != nil {
			os.Remove(csoPath)
			return err
		}
		// The game may have been deleted meanwhile, taking its ISO with it; its CSO goes too
		info, err := os.Stat(isoPath)
		if err != nil {
			os.Remove(csoPath)
			return err
		}
		// A disc that hardly compresses (one of video, mostly) stays an ISO, and is remembered so it isn't tried again
		// at every start
		if size >= info.Size() {
			os.Remove(csoPath)
			log.Printf("Keeping %s as it is: compressed, it's no smaller", isoFileID)
			return os.WriteFile(isoPath+keptMarker, nil, 0o666)
		}
		megabytes := func(n int64) int64 { return int64(math.Round(float64(n) / 1048576)) }
		log.Printf("Compressed %s: %d MB to %d MB in %ds", isoFileID, megabytes(info.Size()), megabytes(size),
			int64(math.Round(time.Since(started).Seconds())))
	}
	// Under the lock the ISO and CSO share, where a delete removes them and an upload looks for them
	unlock := files.Lock(isoFileID)
	_, err := c.Database.Exec(`UPDATE roms SET file_id = ?, updated_at = ? WHERE file_id = ?`, csoFileID,
		db.Millis(time.Now()), isoFileID)
	if err == nil {
		// Deleted while it was compressed or checked, no game uses the CSO
		var used bool
		if used, err = c.isUsed(csoFileID); err == nil && !used {
			os.Remove(csoPath)
		}
	}
	unlock()
	if err != nil {
		return err
	}
	c.mutex.Lock()
	c.replaced[isoFileID] = true
	c.mutex.Unlock()
	// By then the game may have been deleted too, taking its CSO with it; the ISO goes all the same
	time.AfterFunc(isoKeptFor, func() { c.removeUnusedISO(isoFileID, true) })
	return nil
}

// isUsed tells whether a game in the library uses a file
func (c *Compressor) isUsed(fileID string) (bool, error) {
	var used string
	err := c.Database.QueryRow(`SELECT id FROM roms WHERE file_id = ? AND status = ? LIMIT 1`, fileID, db.StatusNormal).
		Scan(&used)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// removeUnusedCSO removes a CSO no game uses, nor the ISO it was made from: one left by a game deleted while it was
// being compressed, by a version that didn't remove it then
func (c *Compressor) removeUnusedCSO(csoFileID string) {
	defer files.Lock(csoFileID)()
	csoPath, ok := c.FilePath(csoFileID)
	if !ok {
		return
	}
	base := strings.TrimSuffix(csoFileID, path.Ext(csoFileID))
	for _, fileID := range []string{csoFileID, base + ".iso", base + ".ISO"} {
		if used, err := c.isUsed(fileID); err != nil || used {
			return
		}
	}
	if os.Remove(csoPath) == nil {
		log.Printf("Removed %s, which no game uses", csoFileID)
	}
}

// removeUnusedISO removes an ISO no game uses any more, once its CSO is in place
func (c *Compressor) removeUnusedISO(isoFileID string, evenWithoutCso bool) {
	defer files.Lock(isoFileID)()
	isoPath, isoOK := c.FilePath(isoFileID)
	csoPath, csoOK := c.FilePath(CsoFileID(isoFileID))
	var used string
	err := c.Database.QueryRow(`SELECT id FROM roms WHERE file_id = ? LIMIT 1`, isoFileID).Scan(&used)
	if err == nil || err != sql.ErrNoRows {
		return
	}
	if isoOK && csoOK && (evenWithoutCso || exists(csoPath)) {
		os.Remove(isoPath)
		os.Remove(isoPath + keptMarker)
	}
}

// CompressAll runs at startup: it compresses PSP ISOs uploaded before compression existed, or whose compression was
// cut short, removes ISOs left behind by a restart during the wait after a swap, and CSOs no game uses
func (c *Compressor) CompressAll() error {
	rows, err := c.Database.Query(`SELECT DISTINCT file_id FROM roms WHERE platform = 'psp' AND status = ? AND file_id LIKE '%.iso'`,
		db.StatusNormal)
	if err != nil {
		return err
	}
	var fileIDs []string
	for rows.Next() {
		var fileID string
		if err := rows.Scan(&fileID); err != nil {
			rows.Close()
			return err
		}
		fileIDs = append(fileIDs, fileID)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return err
	}
	for _, fileID := range fileIDs {
		<-c.Compress(fileID)
	}

	directory, ok := c.FilePath("roms/psp")
	if !ok {
		return nil
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil
	}
	csoName := regexp.MustCompile(`(?i)\.cso$`)
	for _, entry := range entries {
		if csoName.MatchString(entry.Name()) {
			if repaired, _ := RepairEnd(filepath.Join(directory, entry.Name())); repaired {
				log.Printf("Repaired the end of roms/psp/%s", entry.Name())
			}
		}
	}
	entries, _ = os.ReadDir(directory)
	for _, entry := range entries {
		fileID := path.Join("roms", "psp", entry.Name())
		c.mutex.Lock()
		replaced := c.replaced != nil && c.replaced[fileID]
		c.mutex.Unlock()
		if isoExtension.MatchString(entry.Name()) && !replaced {
			c.removeUnusedISO(fileID, false)
		}
		if csoName.MatchString(entry.Name()) && entry.Type().IsRegular() {
			c.removeUnusedCSO(fileID)
		}
	}
	return nil
}
