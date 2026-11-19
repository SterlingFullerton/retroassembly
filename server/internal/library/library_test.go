package library

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/failure"
)

func setup(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id)
		VALUES ('Game.nes', 'nes', 1, 'rom1', 1, 1, 'roms/nes/a.nes', 'owner'),
		       ('Gone.nes', 'nes', 1, 'rom2', 0, 1, 'roms/nes/b.nes', 'owner')`)
	if err != nil {
		t.Fatal(err)
	}
	return database
}

func TestFindRom(t *testing.T) {
	database := setup(t)
	ctx := context.Background()
	owner := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner"}}
	sharing := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "guest", LibraryMode: 1}}
	someoneElse := Scope{Database: database, LibraryOwnerID: "other", User: &auth.User{ID: "other"}}

	if rom, err := FindRom(ctx, owner, "rom1"); err != nil || rom.Platform != "nes" {
		t.Fatalf("the owner's game: %v, %v", rom, err)
	}
	if _, err := FindRom(ctx, sharing, "rom1"); err != nil {
		t.Fatalf("a user sharing the library sees its games: %v", err)
	}
	var known *failure.Error
	if _, err := FindRom(ctx, someoneElse, "rom1"); !errors.As(err, &known) || known.Status != 404 {
		t.Fatalf("someone else's game is not found: %v", err)
	}
	if _, err := FindRom(ctx, owner, "rom2"); !errors.As(err, &known) || known.Status != 404 {
		t.Fatalf("a deleted game is not found: %v", err)
	}
	if !sharing.SharesLibrary() || owner.SharesLibrary() {
		t.Fatal("SharesLibrary")
	}
}

func TestFavorites(t *testing.T) {
	database := setup(t)
	ctx := context.Background()
	scope := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner"}}

	first, err := AddFavorite(ctx, scope, "rom1")
	if err != nil || first.Status != db.StatusNormal || first.RomID != "rom1" {
		t.Fatalf("add: %+v, %v", first, err)
	}
	again, err := AddFavorite(ctx, scope, "rom1")
	if err != nil || again.ID != first.ID {
		t.Fatalf("adding again keeps the same favorite: %+v, %v", again, err)
	}
	if err := RemoveFavorite(ctx, scope, "rom1"); err != nil {
		t.Fatal(err)
	}
	restored, err := AddFavorite(ctx, scope, "rom1")
	if err != nil || restored.ID != first.ID || restored.Status != db.StatusNormal {
		t.Fatalf("adding after removing brings the same one back: %+v, %v", restored, err)
	}
	var rows int
	database.QueryRow(`SELECT count(*) FROM favorites`).Scan(&rows)
	if rows != 1 {
		t.Fatalf("%d favorites rows, want 1", rows)
	}
	if _, err := AddFavorite(ctx, scope, "rom2"); err == nil {
		t.Fatal("a deleted game can't be a favorite")
	}
}

func TestLaunchRecords(t *testing.T) {
	database := setup(t)
	ctx := context.Background()
	scope := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner"}}
	for range 2 {
		if err := AddLaunchRecord(ctx, scope, "rom1", "fceumm"); err != nil {
			t.Fatal(err)
		}
	}
	if err := AddLaunchRecord(ctx, scope, "nope", "fceumm"); err == nil {
		t.Fatal("a game not in the library can't be launched")
	}
	if err := RemoveLaunchRecords(ctx, scope, "rom1"); err != nil {
		t.Fatal(err)
	}
	var live, platform string
	database.QueryRow(`SELECT count(*) FILTER (WHERE status = 1), max(platform) FROM launch_records`).Scan(&live, &platform)
	if live != "0" || platform != "nes" {
		t.Fatalf("live records %s, platform %s", live, platform)
	}
}
