package files

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"

	"retroassembly/server/internal/ids"
)

// Storage is the stored files, by their ids, wherever each kind is kept
type Storage struct {
	// Path is where a file id is on disk, or false for an id that would reach outside its folder
	Path func(id string) (string, bool)
}

var errInvalidFileID = errors.New("Invalid file id")

func (s Storage) writablePath(id string) (string, error) {
	filePath, ok := s.Path(id)
	if !ok {
		return "", errInvalidFileID
	}
	return filePath, nil
}

// Put stores a file under an id
func (s Storage) Put(id string, content io.Reader) error {
	filePath, err := s.writablePath(id)
	if err != nil {
		return err
	}
	return Put(filePath, content)
}

// Delete removes a stored file; one that isn't there is already gone
func (s Storage) Delete(id string) error {
	filePath, err := s.writablePath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// Exists tells whether a stored file is there
func (s Storage) Exists(id string) bool {
	filePath, ok := s.Path(id)
	return ok && Exists(filePath)
}

// Read is a stored file's content, or os.ErrNotExist
func (s Storage) Read(id string) ([]byte, error) {
	filePath, ok := s.Path(id)
	if !ok {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(filePath)
}

// Exists tells whether a stored file is on disk
func Exists(filePath string) bool {
	info, err := os.Stat(filePath)
	return err == nil && info.Mode().IsRegular()
}

// Put writes a stored file. It's written under a temporary name first, so an interrupted write never leaves a partial
// file behind
func Put(filePath string, content io.Reader) (err error) {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}
	partial := filePath + "." + ids.New() + ".partial"
	defer os.Remove(partial)
	file, err := os.Create(partial)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, content); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(partial, filePath)
}

// PartialDigest names a file by its first and last kilobyte and its size, as getFilePartialDigest does, without
// reading a large file whole. A file under a kilobyte is read twice, as the Node server reads it
func PartialDigest(file io.ReaderAt, size int64) (string, error) {
	const part = 1024
	header := make([]byte, min(size, part))
	if _, err := file.ReadAt(header, 0); err != nil && err != io.EOF {
		return "", err
	}
	start := max(size-part, 0)
	footer := make([]byte, size-start)
	if _, err := file.ReadAt(footer, start); err != nil && err != io.EOF {
		return "", err
	}
	data := append(append(header, footer...), make([]byte, 8)...)
	binary.LittleEndian.PutUint64(data[len(data)-8:], uint64(size))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:16], nil
}
