package files

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RemoveStaleTemporaries removes what writes cut short left behind in a folder: the files written under a temporary
// name (".partial" or ".tmp") and never renamed. Only those older than olderThan go, so a write under way in another
// process sharing the folder is left alone
func RemoveStaleTemporaries(folder string, olderThan time.Duration) int {
	removed := 0
	cutoff := time.Now().Add(-olderThan)
	filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".partial") && !strings.HasSuffix(name, ".tmp") {
			return nil
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Before(cutoff) && os.Remove(path) == nil {
			removed++
		}
		return nil
	})
	return removed
}
