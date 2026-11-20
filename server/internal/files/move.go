package files

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"syscall"

	"retroassembly/server/internal/ids"
)

// MoveFile moves a file, making the folder it goes into, as src/utils/server/move-file.ts does. Between disks, where a
// rename can't work, it's copied under a temporary name first and the original removed once the copy is complete, so
// neither is ever left half-written
func MoveFile(from, to string) error {
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	err := os.Rename(from, to)
	if err == nil || !errors.Is(err, syscall.EXDEV) {
		return err
	}
	partial := to + "." + ids.New() + ".partial"
	defer os.Remove(partial)
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.Create(partial)
	if err != nil {
		return err
	}
	if _, err := io.Copy(destination, source); err != nil {
		destination.Close()
		return err
	}
	if err := destination.Close(); err != nil {
		return err
	}
	if err := os.Rename(partial, to); err != nil {
		return err
	}
	return os.Remove(from)
}

// MoveFolderContents moves every file in one folder into another, keeping their places inside it, and removes the
// folders left empty. A file already at its destination is left where it was, as is one gone by the time it's reached
// (the Node server may be moving the same files). Returns how many were moved
func MoveFolderContents(from, to string) (int, error) {
	var (
		moved   int
		folders []string
	)
	err := filepath.WalkDir(from, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == from {
				return filepath.SkipAll
			}
			return nil
		}
		if entry.IsDir() {
			if path != from {
				folders = append(folders, path)
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(to, relative)
		if _, err := os.Lstat(destination); err == nil {
			return nil
		}
		if err := MoveFile(path, destination); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		moved++
		return nil
	})
	if err != nil {
		return moved, err
	}
	// Deepest first, so a folder is empty by the time it's reached; one that still holds a file is kept
	sort.SliceStable(folders, func(i, j int) bool { return len(folders[i]) > len(folders[j]) })
	for _, folder := range append(folders, from) {
		os.Remove(folder)
	}
	return moved, nil
}
