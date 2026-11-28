package psp

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"retroassembly/server/internal/db"
)

func compressor(t *testing.T) (*Compressor, *sql.DB, string) {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	folder := t.TempDir()
	if err := os.MkdirAll(filepath.Join(folder, "roms", "psp"), 0o755); err != nil {
		t.Fatal(err)
	}
	return &Compressor{Database: database, FilePath: func(id string) (string, bool) {
		return filepath.Join(folder, filepath.FromSlash(id)), true
	}}, database, folder
}

// A game deleted before its ISO's compression is done leaves no CSO behind
func TestCompressOfADeletedGameLeavesNoCso(t *testing.T) {
	c, database, folder := compressor(t)
	if err := os.WriteFile(filepath.Join(folder, "roms", "psp", "a.iso"), disc(), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id)
		VALUES ('A.iso', 'psp', 1, 'a', 0, 1, 'roms/psp/a.iso', 'owner')`); err != nil {
		t.Fatal(err)
	}
	<-c.Compress("roms/psp/a.iso")
	if _, err := os.Stat(filepath.Join(folder, "roms", "psp", "a.cso")); !os.IsNotExist(err) {
		t.Errorf("the CSO is there (%v), with no game using it", err)
	}
}

// At start, CSOs no game uses, nor the ISO they were made from, are removed
func TestCompressAllRemovesUnusedCsos(t *testing.T) {
	c, database, folder := compressor(t)
	for _, name := range []string{"used.cso", "unused.cso", "waiting.cso", "waiting.iso.uncompressed"} {
		if err := os.WriteFile(filepath.Join(folder, "roms", "psp", name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.Exec(`INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id) VALUES
		('Used.iso', 'psp', 1, 'u', 1, 1, 'roms/psp/used.cso', 'owner'),
		('Unused.iso', 'psp', 1, 'n', 0, 1, 'roms/psp/unused.cso', 'owner'),
		('Waiting.iso', 'psp', 1, 'w', 1, 1, 'roms/psp/waiting.iso', 'owner')`); err != nil {
		t.Fatal(err)
	}
	if err := c.CompressAll(); err != nil {
		t.Fatal(err)
	}
	for name, kept := range map[string]bool{"used.cso": true, "unused.cso": false, "waiting.cso": true} {
		if _, err := os.Stat(filepath.Join(folder, "roms", "psp", name)); (err == nil) != kept {
			t.Errorf("%s: %v, want kept %v", name, err, kept)
		}
	}
}
