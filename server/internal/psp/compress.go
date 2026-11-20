package psp

import (
	"database/sql"
	"log"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"retroassembly/server/internal/db"
)

// An uploaded ISO is playable straight away and compressed afterwards, in the background, one game at a time

// An ISO stays this long after its CSO replaces it, for pages that loaded before the swap and are about to download it
const isoKeptFor = 10 * time.Minute

var isoExtension = regexp.MustCompile(`(?i)\.iso$`)

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
		if previous != nil {
			<-previous
		}
		if err := c.compress(isoFileID); err != nil {
			log.Printf("Couldn't compress %s, keeping the ISO %v", isoFileID, err)
		}
		c.mutex.Lock()
		delete(c.queued, isoFileID)
		c.mutex.Unlock()
		close(done)
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
	if !isoOK || !csoOK || csoFileID == isoFileID || !exists(isoPath) {
		return nil
	}
	// A CSO already there is from another upload of the same disc, or an earlier run stopped before the swap
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
		info, err := os.Stat(isoPath)
		if err != nil {
			return err
		}
		megabytes := func(n int64) int64 { return int64(math.Round(float64(n) / 1048576)) }
		log.Printf("Compressed %s: %d MB to %d MB in %ds", isoFileID, megabytes(info.Size()), megabytes(size),
			int64(math.Round(time.Since(started).Seconds())))
	}
	if _, err := c.Database.Exec(`UPDATE roms SET file_id = ?, updated_at = ? WHERE file_id = ?`, csoFileID,
		db.Millis(time.Now()), isoFileID); err != nil {
		return err
	}
	c.mutex.Lock()
	c.replaced[isoFileID] = true
	c.mutex.Unlock()
	// By then the game may have been deleted too, taking its CSO with it; the ISO goes all the same
	time.AfterFunc(isoKeptFor, func() { c.removeUnusedISO(isoFileID, true) })
	return nil
}

// removeUnusedISO removes an ISO no game uses any more, once its CSO is in place
func (c *Compressor) removeUnusedISO(isoFileID string, evenWithoutCso bool) {
	isoPath, isoOK := c.FilePath(isoFileID)
	csoPath, csoOK := c.FilePath(CsoFileID(isoFileID))
	var used string
	err := c.Database.QueryRow(`SELECT id FROM roms WHERE file_id = ? LIMIT 1`, isoFileID).Scan(&used)
	if err == nil || err != sql.ErrNoRows {
		return
	}
	if isoOK && csoOK && (evenWithoutCso || exists(csoPath)) {
		os.Remove(isoPath)
	}
}

// CompressAll runs at startup: it compresses PSP ISOs uploaded before compression existed, or whose compression was
// cut short, and removes ISOs left behind by a restart during the wait after a swap
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
	rows.Close()
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
	}
	return nil
}
