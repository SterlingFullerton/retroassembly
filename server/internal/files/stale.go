package files

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// What the app writes under a temporary name: the file's own name, a random id from internal/ids, and ".partial" or
// ".tmp". A file merely ending in ".partial" or ".tmp" is someone else's, such as a download another program will resume
var temporaryName = regexp.MustCompile(`.\.[346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz]{10}\.(?:partial|tmp)$`)

// RemoveStaleTemporaries removes what writes cut short left behind in a folder: the files the app wrote under a
// temporary name and never renamed. Only those older than olderThan go, so a write under way in another process sharing
// the folder is left alone. With depth above zero, only that many levels of the folder are gone through: the games
// folder may be a whole collection, where the app writes only in each console's folder
func RemoveStaleTemporaries(folder string, depth int, olderThan time.Duration) int {
	removed := 0
	cutoff := time.Now().Add(-olderThan)
	filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if relative, err := filepath.Rel(folder, path); depth > 0 && err == nil && relative != "." &&
				strings.Count(relative, string(filepath.Separator))+1 >= depth {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() || !temporaryName.MatchString(entry.Name()) {
			return nil
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Before(cutoff) && os.Remove(path) == nil {
			removed++
		}
		return nil
	})
	return removed
}
