package savezip

import (
	"archive/zip"
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"path/filepath"
	"testing"
)

var sample = []File{
	{Content: []byte("param"), Path: "ULUS10376DATA00/PARAM.SFO"},
	{Content: []byte{0, 1, 2, 255, 254}, Path: "ULUS10376DATA00/DATA.BIN"},
	{Content: []byte("icon"), Path: "ICON0.PNG"},
	{Content: []byte("unicode name"), Path: "ULUS10376DATA00/sub/ö.bin"},
}

func TestZipIsTheBrowsers(t *testing.T) {
	// The checksum of src/emulator/save-folder.ts's zipSaveFiles of the same files: the same saves, the same bytes
	const browsers = "a2a91b6e3d765be4737c8a028a4a80def6478d23"
	zipped := Zip(sample)
	sum := sha1.Sum(zipped)
	if got := hex.EncodeToString(sum[:]); got != browsers || len(zipped) != 520 {
		t.Fatalf("zip %s, %d bytes; the browser's is %s, 520 bytes", got, len(zipped), browsers)
	}
	// In any order
	reversed := []File{sample[3], sample[2], sample[1], sample[0]}
	if !bytes.Equal(Zip(reversed), zipped) {
		t.Fatal("the order the files came in changed the zip")
	}
}

func TestUnzip(t *testing.T) {
	files, err := Unzip(Zip(sample), "SAVEDATA")
	if err != nil || len(files) != len(sample) {
		t.Fatalf("unzipped %d files: %v", len(files), err)
	}

	// A zip of the whole folder, compressed, as one made on a computer: read as the folder's contents, and nothing
	// outside it
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range []string{"SAVEDATA/GAME/DATA.BIN", "SAVEDATA/../escape", "SAVEDATA/GAME/"} {
		file, _ := writer.Create(name)
		_, _ = file.Write([]byte(name))
	}
	_ = writer.Close()
	files, err = Unzip(buffer.Bytes(), "SAVEDATA")
	if err != nil || len(files) != 1 || files[0].Path != "GAME/DATA.BIN" {
		t.Fatalf("unzipped %+v: %v", files, err)
	}
}

func TestReadAndWrite(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "SAVEDATA")
	if files, err := Read(folder); err != nil || len(files) != 0 {
		t.Fatalf("a folder not there: %+v %v", files, err)
	}
	if err := Write(folder, sample); err != nil {
		t.Fatal(err)
	}
	files, err := Read(folder)
	if err != nil || !bytes.Equal(Zip(files), Zip(sample)) {
		t.Fatalf("read back %+v: %v", files, err)
	}
	// Written again, it's only what's given
	if err := Write(folder, sample[:1]); err != nil {
		t.Fatal(err)
	}
	if files, _ := Read(folder); len(files) != 1 {
		t.Fatalf("after writing one file, %d", len(files))
	}
}
