package psp

import (
	"bytes"
	"compress/flate"
	"crypto/rand"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// readCso reads a CSO the way an emulator does: each block found through the index, and unpacked on its own
func readCso(t *testing.T, cso []byte) []byte {
	t.Helper()
	if string(cso[:4]) != "CISO" {
		t.Fatal("not a CSO")
	}
	total := int64(binary.LittleEndian.Uint64(cso[8:]))
	size := int64(binary.LittleEndian.Uint32(cso[16:]))
	align := uint(cso[21])
	blocks := (total + size - 1) / size
	var disc []byte
	for number := int64(0); number < blocks; number++ {
		entry := binary.LittleEndian.Uint32(cso[24+number*4:])
		next := binary.LittleEndian.Uint32(cso[24+(number+1)*4:])
		content := cso[int64(entry&0x7fffffff)<<align : int64(next&0x7fffffff)<<align]
		if entry&0x80000000 == 0 {
			unpacked, err := io.ReadAll(flate.NewReader(bytes.NewReader(content)))
			if err != nil {
				t.Fatal(err)
			}
			content = unpacked
		}
		disc = append(disc, content...)
	}
	return disc[:total]
}

// A disc's mix: empty space, repetitive data, and data that doesn't compress (video), ending part way into a block
func disc() []byte {
	random := make([]byte, 250_000)
	rand.Read(random)
	return bytes.Join([][]byte{
		make([]byte, 300_000), []byte(strings.Repeat("PSP GAME DATA ", 40_000)), random, bytes.Repeat([]byte{7}, 1234),
	}, nil)
}

func TestCompress(t *testing.T) {
	directory := t.TempDir()
	content := disc()
	iso, cso := filepath.Join(directory, "game.iso"), filepath.Join(directory, "game.cso")
	os.WriteFile(iso, content, 0o644)
	size, err := Compress(iso, cso, -1)
	if err != nil {
		t.Fatal(err)
	}
	written, _ := os.ReadFile(cso)
	if int64(len(written)) != size || size >= int64(len(content))/2 {
		t.Fatalf("size %d of %d", size, len(content))
	}
	if !bytes.Equal(readCso(t, written), content) {
		t.Fatal("a different disc")
	}
	if err := Check(cso, iso); err != nil {
		t.Fatal(err)
	}

	// Not accepted if it differs from the ISO
	changed := bytes.Clone(content)
	changed[400_000] ^= 1
	os.WriteFile(iso, changed, 0o644)
	if err := Check(cso, iso); err == nil || !strings.Contains(err.Error(), "differs") {
		t.Fatalf("difference not found: %v", err)
	}

	// Nothing left behind when it fails
	if _, err := Compress(filepath.Join(directory, "missing.iso"), filepath.Join(directory, "missing.cso"), -1); err == nil {
		t.Fatal("no error")
	}
	if matches, _ := filepath.Glob(filepath.Join(directory, "missing.cso*")); len(matches) > 0 {
		t.Fatalf("left behind: %v", matches)
	}
}

func TestAligned(t *testing.T) {
	directory := t.TempDir()
	content := disc()
	iso, cso := filepath.Join(directory, "aligned.iso"), filepath.Join(directory, "aligned.cso")
	os.WriteFile(iso, content, 0o644)
	size, err := Compress(iso, cso, 2)
	if err != nil {
		t.Fatal(err)
	}
	written, _ := os.ReadFile(cso)
	blocks := (len(content) + blockSize - 1) / blockSize
	if written[21] != 2 || size%4 != 0 || int(binary.LittleEndian.Uint32(written[24+blocks*4:]))*4 != len(written) {
		t.Fatal("not aligned to its end")
	}
	if !bytes.Equal(readCso(t, written), content) || Check(cso, iso) != nil {
		t.Fatal("a different disc")
	}

	// An earlier version stopped where the last block's data did, before the padding to a multiple of 4
	padding := 0
	for padding < 3 && written[size-1-int64(padding)] == 0 {
		padding++
	}
	if padding == 0 {
		t.Skip("this disc's last block ends on a multiple of 4")
	}
	os.Truncate(cso, size-int64(padding))
	if err := Check(cso, iso); err == nil || !strings.Contains(err.Error(), "before its index's end") {
		t.Fatalf("short CSO accepted: %v", err)
	}
	if repaired, err := RepairEnd(cso); !repaired || err != nil {
		t.Fatalf("not repaired: %v", err)
	}
	if err := Check(cso, iso); err != nil {
		t.Fatal(err)
	}
	if repaired, _ := RepairEnd(cso); repaired {
		t.Fatal("repaired twice")
	}
}

func TestAlign(t *testing.T) {
	// LEGO Batman's 1.1 GB, and a full 1.8 GB UMD
	for _, test := range []struct {
		bytes int64
		align uint
	}{{1_136_689_152, 0}, {1_900_000_000, 0}, {4_000_000_000, 1}} {
		if got := Align((test.bytes + blockSize - 1) / blockSize); got != test.align {
			t.Errorf("%d bytes: %d", test.bytes, got)
		}
	}
	if !IsCompressible("psp", "roms/psp/abc.iso") || IsCompressible("psp", "roms/psp/abc.cso") ||
		IsCompressible("psx", "roms/psx/abc.iso") || CsoFileID("roms/psp/abc.ISO") != "roms/psp/abc.cso" {
		t.Fatal("wrong files compressed")
	}
}

// A CSO the Node server wrote is read the same (RETROASSEMBLY_NODE_CSO and RETROASSEMBLY_NODE_ISO)
func TestNodeCso(t *testing.T) {
	cso, iso := os.Getenv("RETROASSEMBLY_NODE_CSO"), os.Getenv("RETROASSEMBLY_NODE_ISO")
	if cso == "" || iso == "" {
		t.Skip("no CSO from the Node server given")
	}
	if err := Check(cso, iso); err != nil {
		t.Fatal(err)
	}
}
