// Package savezip keeps a game's own saves that are a folder of files (a PSP's SAVEDATA) as one zip, as the app does
// in the browser (src/emulator/save-folder.ts): uncompressed, its files in name order, every one dated 1 January 1980,
// so the same saves always make the same bytes, byte for byte the browser's. A save that hasn't changed is then never
// kept again, whichever made it.
package savezip

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// The earliest date a zip can hold, 1 January 1980 at midnight, as the zip format writes a date and a time
const (
	dosTime = 0
	dosDate = 1<<5 | 1
)

// File is one file of the saves, by its path in the folder with forward slashes
type File struct {
	Path    string
	Content []byte
}

// Zip is the files as the browser zips them
func Zip(files []File) []byte {
	sorted := append([]File(nil), files...)
	sort.Slice(sorted, func(a, b int) bool { return sorted[a].Path < sorted[b].Path })
	var local, central bytes.Buffer
	for _, file := range sorted {
		name := []byte(file.Path)
		crc := crc32.ChecksumIEEE(file.Content)
		offset := uint32(local.Len())
		header := make([]byte, 30)
		binary.LittleEndian.PutUint32(header[0:], 0x04034b50)
		binary.LittleEndian.PutUint16(header[4:], 20)
		// Bit 11: the name is UTF-8
		binary.LittleEndian.PutUint16(header[6:], 0x0800)
		binary.LittleEndian.PutUint16(header[10:], dosTime)
		binary.LittleEndian.PutUint16(header[12:], dosDate)
		binary.LittleEndian.PutUint32(header[14:], crc)
		binary.LittleEndian.PutUint32(header[18:], uint32(len(file.Content)))
		binary.LittleEndian.PutUint32(header[22:], uint32(len(file.Content)))
		binary.LittleEndian.PutUint16(header[26:], uint16(len(name)))
		local.Write(header)
		local.Write(name)
		local.Write(file.Content)

		entry := make([]byte, 46)
		binary.LittleEndian.PutUint32(entry[0:], 0x02014b50)
		binary.LittleEndian.PutUint16(entry[4:], 20)
		binary.LittleEndian.PutUint16(entry[6:], 20)
		binary.LittleEndian.PutUint16(entry[8:], 0x0800)
		binary.LittleEndian.PutUint16(entry[12:], dosTime)
		binary.LittleEndian.PutUint16(entry[14:], dosDate)
		binary.LittleEndian.PutUint32(entry[16:], crc)
		binary.LittleEndian.PutUint32(entry[20:], uint32(len(file.Content)))
		binary.LittleEndian.PutUint32(entry[24:], uint32(len(file.Content)))
		binary.LittleEndian.PutUint16(entry[28:], uint16(len(name)))
		binary.LittleEndian.PutUint32(entry[42:], offset)
		central.Write(entry)
		central.Write(name)
	}
	end := make([]byte, 22)
	binary.LittleEndian.PutUint32(end[0:], 0x06054b50)
	binary.LittleEndian.PutUint16(end[8:], uint16(len(sorted)))
	binary.LittleEndian.PutUint16(end[10:], uint16(len(sorted)))
	binary.LittleEndian.PutUint32(end[12:], uint32(central.Len()))
	binary.LittleEndian.PutUint32(end[16:], uint32(local.Len()))
	return append(append(local.Bytes(), central.Bytes()...), end...)
}

// Unzip is the files in a zip of saves, compressed or not. A zip of the whole folder, with the folder's own name at
// the start of every path (`SAVEDATA/…`), is read as the folder's contents. Nothing outside the folder is taken
func Unzip(data []byte, folderName string) ([]File, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	var entries []*zip.File
	for _, entry := range reader.File {
		if !entry.FileInfo().IsDir() && !strings.HasSuffix(entry.Name, "/") {
			entries = append(entries, entry)
		}
	}
	prefix := folderName + "/"
	wrapped := len(entries) > 0
	for _, entry := range entries {
		wrapped = wrapped && strings.HasPrefix(entry.Name, prefix)
	}
	var files []File
	for _, entry := range entries {
		name := entry.Name
		if wrapped {
			name = strings.TrimPrefix(name, prefix)
		}
		if name == "" || strings.HasPrefix(name, "/") || slicesContains(strings.Split(name, "/"), "..") {
			continue
		}
		opened, err := entry.Open()
		if err != nil {
			return nil, err
		}
		content, err := io.ReadAll(io.LimitReader(opened, 256<<20))
		_ = opened.Close()
		if err != nil {
			return nil, err
		}
		files = append(files, File{Content: content, Path: name})
	}
	return files, nil
}

func slicesContains(parts []string, value string) bool {
	for _, part := range parts {
		if part == value {
			return true
		}
	}
	return false
}

// Read is every file in a folder, by its path in it
func Read(folder string) ([]File, error) {
	var files []File
	err := filepath.WalkDir(folder, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(folder, file)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		files = append(files, File{Content: content, Path: filepath.ToSlash(relative)})
		return nil
	})
	return files, err
}

// Write puts the files in a folder, in place of whatever was there
func Write(folder string, files []File) error {
	if err := os.RemoveAll(folder); err != nil {
		return err
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return err
	}
	for _, file := range files {
		target := filepath.Join(folder, filepath.FromSlash(path.Clean("/"+file.Path)))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, file.Content, 0o644); err != nil {
			return err
		}
	}
	return nil
}
