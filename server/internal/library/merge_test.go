package library

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"retroassembly/server/internal/files"
)

func TestMergeLibraries(t *testing.T) {
	database := setup(t)
	ctx := context.Background()
	folder := t.TempDir()
	storage := files.Storage{Path: func(id string) (string, bool) { return filepath.Join(folder, filepath.FromSlash(id)), true }}
	write := func(id string) {
		t.Helper()
		filePath, _ := storage.Path(id)
		if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filePath, []byte(id), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	exists := func(id string) bool {
		filePath, _ := storage.Path(id)
		_, err := os.Stat(filePath)
		return err == nil
	}
	count := func(query string, arguments ...any) int {
		t.Helper()
		var n int
		if err := database.QueryRow(query, arguments...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// The owner has Game.nes. A friend with a library of their own has Game.nes too, as other content, and Other.nes;
	// they've a save state, a favorite and a play of each, and the owner has their own favorite of Game.nes
	_, err := database.Exec(`
		INSERT INTO users (id, username, role, library_mode, status, created_at, updated_at) VALUES
			('owner', 'owner', 'admin', 0, 1, 1, 1), ('friend', 'friend', 'contributor', 0, 1, 2, 2);
		INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id) VALUES
			('Game.nes', 'nes', 2, 'theirs', 1, 2, 'roms/nes/c.nes', 'friend'),
			('Other.nes', 'nes', 2, 'other', 1, 2, 'roms/nes/d.nes', 'friend');
		INSERT INTO favorites (rom_id, user_id, created_at, id, status, updated_at) VALUES
			('rom1', 'owner', 1, 'f1', 1, 1), ('theirs', 'friend', 1, 'f2', 1, 1), ('other', 'friend', 1, 'f3', 1, 1),
			('rom1', 'friend', 1, 'f4', 1, 1);
		INSERT INTO launch_records (core, platform, rom_id, user_id, created_at, id, status, updated_at) VALUES
			('fceumm', 'nes', 'theirs', 'friend', 1, 'l1', 1, 1), ('fceumm', 'nes', 'other', 'friend', 1, 'l2', 1, 1);
		INSERT INTO states (core, platform, rom_id, thumbnail_file_id, type, created_at, id, status, updated_at, file_id, user_id) VALUES
			('fceumm', 'nes', 'theirs', 't', 'manual', 1, 's1', 1, 1, 'f', 'friend')`)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"roms/nes/a.nes", "roms/nes/c.nes", "roms/nes/d.nes"} {
		write(id)
	}

	moved, replaced, err := MergeLibraries(ctx, database, storage)
	if err != nil || moved != 1 || replaced != 1 {
		t.Fatalf("moved %d, replaced %d: %v", moved, replaced, err)
	}
	// One library, under its owner, with one Game.nes and the friend's Other.nes
	if count(`SELECT count(*) FROM roms WHERE status = 1`) != 2 || count(`SELECT count(*) FROM roms WHERE status = 1 AND user_id != 'owner'`) != 0 {
		t.Fatal("the games aren't all the owner's")
	}
	if count(`SELECT count(*) FROM roms WHERE id = 'theirs' AND status = 0`) != 1 {
		t.Fatal("the friend's copy of Game.nes is still a game")
	}
	// What the friend had of their copy follows the library's game; what they had of both is kept once
	if count(`SELECT count(*) FROM states WHERE rom_id = 'rom1' AND user_id = 'friend'`) != 1 ||
		count(`SELECT count(*) FROM launch_records WHERE rom_id = 'rom1' AND user_id = 'friend'`) != 1 ||
		count(`SELECT count(*) FROM favorites WHERE rom_id = 'rom1' AND user_id = 'friend'`) != 1 ||
		count(`SELECT count(*) FROM favorites WHERE rom_id = 'theirs'`) != 0 ||
		count(`SELECT count(*) FROM favorites WHERE rom_id = 'rom1' AND user_id = 'owner'`) != 1 ||
		count(`SELECT count(*) FROM favorites WHERE rom_id = 'other' AND user_id = 'friend'`) != 1 {
		t.Fatal("the friend's saves, favorites or history didn't follow")
	}
	// The stood-in-for game's file goes; the others stay
	if exists("roms/nes/c.nes") || !exists("roms/nes/a.nes") || !exists("roms/nes/d.nes") {
		t.Fatal("the wrong game files are left")
	}

	// Nothing more to do the next time
	if moved, replaced, err := MergeLibraries(ctx, database, storage); err != nil || moved+replaced != 0 {
		t.Fatalf("again: moved %d, replaced %d: %v", moved, replaced, err)
	}
}
