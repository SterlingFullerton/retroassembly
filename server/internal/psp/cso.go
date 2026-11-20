// Package psp keeps PSP games as CSO, compressed discs PPSSPP reads directly: smaller to download and to hold while
// playing, as src/utils/server/cso.ts and compress-psp-games.ts do.
package psp

import (
	"bytes"
	"compress/flate"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"

	"retroassembly/server/internal/ids"
)

// CSO (compressed ISO, version 1): a 24-byte header, an index of where each block starts, then the blocks, each
// compressed on its own with raw deflate so an emulator can unpack just the part of the disc it's reading

const (
	headerSize = 24
	blockSize  = 2048
	// Index entries with this bit set are blocks stored as they are, because compressing them made them no smaller
	plainFlag = 0x80000000
	// Blocks read and written together (2 MB)
	batchSize = 1024
	// Blocks compressed or unpacked at the same time
	parallel = 16
)

// inGroups runs work for each item, parallel at a time
func inGroups[T any](count int, work func(index int) (T, error)) ([]T, error) {
	results := make([]T, count)
	errs := make([]error, count)
	for start := 0; start < count; start += parallel {
		var group sync.WaitGroup
		for index := start; index < min(start+parallel, count); index++ {
			group.Go(func() { results[index], errs[index] = work(index) })
		}
		group.Wait()
	}
	return results, errors.Join(errs...)
}

// Align is the smallest alignment that lets every block's position fit the index's 31 bits, even if nothing
// compresses: blocks start at multiples of 2^align, and the index holds their positions divided by it
func Align(blockCount int64) uint {
	for align := uint(0); ; align++ {
		largest := headerSize + (blockCount+1)*4 + blockCount*(blockSize+1<<align-1)
		if float64(largest)/float64(int64(1)<<align) <= 0x7fffffff {
			return align
		}
	}
}

func header(totalBytes int64, align uint) []byte {
	head := make([]byte, headerSize)
	copy(head, "CISO")
	binary.LittleEndian.PutUint32(head[4:], headerSize)
	binary.LittleEndian.PutUint64(head[8:], uint64(totalBytes))
	binary.LittleEndian.PutUint32(head[16:], blockSize)
	head[20] = 1
	head[21] = byte(align)
	return head
}

func deflate(block []byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer, err := flate.NewWriter(&buffer, flate.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := writer.Write(block); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// Compress writes the ISO at isoPath as a CSO at csoPath, aligned at align, or the smallest alignment that fits when
// align is negative. It's written under a temporary name of its own first, so an interrupted compression never leaves
// a partial file behind, nor meets one the Node server is writing. Returns the CSO's size
func Compress(isoPath, csoPath string, align int) (size int64, err error) {
	input, err := os.Open(isoPath)
	if err != nil {
		return 0, err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return 0, err
	}
	partial := csoPath + "." + ids.New() + ".partial"
	output, err := os.Create(partial)
	if err != nil {
		return 0, err
	}
	defer func() {
		output.Close()
		if err != nil {
			os.Remove(partial)
		}
	}()

	totalBytes := info.Size()
	blockCount := (totalBytes + blockSize - 1) / blockSize
	alignment := uint(align)
	if align < 0 {
		alignment = Align(blockCount)
	}
	unit := int64(1) << alignment
	index := make([]uint32, blockCount+1)
	position := int64(headerSize) + int64(len(index))*4
	padding := make([]byte, unit)

	batch := make([]byte, batchSize*blockSize)
	for first := int64(0); first < blockCount; first += batchSize {
		read, err := input.ReadAt(batch, first*blockSize)
		if err != nil && !errors.Is(err, io.EOF) {
			return 0, err
		}
		count := (read + blockSize - 1) / blockSize
		blocks := make([][]byte, count)
		for i := range blocks {
			blocks[i] = batch[i*blockSize : min((i+1)*blockSize, read)]
		}
		compressed, err := inGroups(count, func(i int) ([]byte, error) { return deflate(blocks[i]) })
		if err != nil {
			return 0, err
		}
		var written bytes.Buffer
		batchStart := position
		for number, block := range blocks {
			// Each block starts at a multiple of 2^align
			if gap := (unit - position%unit) % unit; gap > 0 {
				written.Write(padding[:gap])
				position += gap
			}
			stored, flag := compressed[number], uint32(0)
			if len(stored) >= len(block) {
				stored, flag = block, plainFlag
			}
			index[first+int64(number)] = uint32(position/unit) | flag
			written.Write(stored)
			position += int64(len(stored))
		}
		if _, err := output.WriteAt(written.Bytes(), batchStart); err != nil {
			return 0, err
		}
	}
	// The file ends on a multiple of 2^align too, where the last index entry says it does
	if end := (position + unit - 1) / unit * unit; end > position {
		if _, err := output.WriteAt(padding[:end-position], position); err != nil {
			return 0, err
		}
		position = end
	}
	index[blockCount] = uint32(position / unit)
	if _, err := output.WriteAt(header(totalBytes, alignment), 0); err != nil {
		return 0, err
	}
	indexBytes := make([]byte, len(index)*4)
	for i, entry := range index {
		binary.LittleEndian.PutUint32(indexBytes[i*4:], entry)
	}
	if _, err := output.WriteAt(indexBytes, headerSize); err != nil {
		return 0, err
	}
	if err := errors.Join(output.Sync(), output.Close()); err != nil {
		return 0, err
	}
	if err := os.Rename(partial, csoPath); err != nil {
		return 0, err
	}
	return position, nil
}

type csoHeader struct {
	align      uint
	blockCount int64
	totalBytes int64
}

func readHeader(file *os.File) (csoHeader, bool, error) {
	head := make([]byte, headerSize)
	if _, err := file.ReadAt(head, 0); err != nil {
		return csoHeader{}, false, err
	}
	if string(head[:4]) != "CISO" || binary.LittleEndian.Uint32(head[16:]) != blockSize {
		return csoHeader{}, false, nil
	}
	totalBytes := int64(binary.LittleEndian.Uint64(head[8:]))
	return csoHeader{align: uint(head[21]), blockCount: (totalBytes + blockSize - 1) / blockSize, totalBytes: totalBytes}, true, nil
}

// Check reads the CSO at csoPath back, block by block, and compares it with the ISO at isoPath. It fails at the first
// difference, so a CSO only replaces its ISO once it's known to hold exactly the same disc
func Check(csoPath, isoPath string) error {
	cso, err := os.Open(csoPath)
	if err != nil {
		return err
	}
	defer cso.Close()
	iso, err := os.Open(isoPath)
	if err != nil {
		return err
	}
	defer iso.Close()
	head, ok, err := readHeader(cso)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Not a CSO this app wrote")
	}
	isoInfo, err := iso.Stat()
	if err != nil {
		return err
	}
	if head.totalBytes != isoInfo.Size() {
		return fmt.Errorf("The CSO holds %d bytes, the ISO %d", head.totalBytes, isoInfo.Size())
	}
	indexBytes := make([]byte, (head.blockCount+1)*4)
	if _, err := cso.ReadAt(indexBytes, headerSize); err != nil {
		return err
	}
	entry := func(number int64) uint32 { return binary.LittleEndian.Uint32(indexBytes[number*4:]) }
	start := func(number int64) int64 { return int64(entry(number)&^plainFlag) << head.align }
	// An emulator refuses a CSO shorter than its index says, as cut short
	csoInfo, err := cso.Stat()
	if err != nil {
		return err
	}
	if start(head.blockCount) > csoInfo.Size() {
		return fmt.Errorf("The CSO ends at %d, before its index's end at %d", csoInfo.Size(), start(head.blockCount))
	}

	original := make([]byte, batchSize*blockSize)
	for first := int64(0); first < head.blockCount; first += batchSize {
		last := min(first+batchSize, head.blockCount)
		read, err := iso.ReadAt(original, first*blockSize)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		from := start(first)
		stored := make([]byte, start(last)-from)
		if _, err := cso.ReadAt(stored, from); err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		blocks, err := inGroups(int(last-first), func(offset int) ([]byte, error) {
			number := first + int64(offset)
			// The next block's start ends this one, with its padding, which raw deflate ignores
			content := stored[start(number)-from : start(number+1)-from]
			expected := min(blockSize, head.totalBytes-number*blockSize)
			if entry(number)&plainFlag != 0 {
				return content[:expected], nil
			}
			return io.ReadAll(flate.NewReader(bytes.NewReader(content)))
		})
		if err != nil {
			return err
		}
		restored := bytes.Join(blocks, nil)
		if !bytes.Equal(restored, original[:read]) {
			return fmt.Errorf("The CSO differs from the ISO between blocks %d and %d", first, last)
		}
	}
	return nil
}

// RepairEnd fixes a CSO written by an earlier version of the app, which could end up to 2^align - 1 bytes short of
// where its index says it ends, so an emulator refused it as cut short. The missing bytes are padding, so they're added
// as zeros. Returns whether it was fixed
func RepairEnd(csoPath string) (bool, error) {
	cso, err := os.OpenFile(csoPath, os.O_RDWR, 0)
	if err != nil {
		return false, err
	}
	defer cso.Close()
	head, ok, err := readHeader(cso)
	if err != nil || !ok {
		return false, err
	}
	last := make([]byte, 4)
	if _, err := cso.ReadAt(last, headerSize+head.blockCount*4); err != nil {
		return false, err
	}
	end := int64(binary.LittleEndian.Uint32(last)&^plainFlag) << head.align
	info, err := cso.Stat()
	if err != nil {
		return false, err
	}
	size := info.Size()
	if end <= size || end-size >= 1<<head.align {
		return false, nil
	}
	if _, err := cso.WriteAt(make([]byte, end-size), size); err != nil {
		return false, err
	}
	return true, nil
}
