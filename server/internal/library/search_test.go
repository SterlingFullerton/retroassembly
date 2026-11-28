package library

import (
	"testing"

	"retroassembly/server/internal/auth"
)

// A search's matches are kept while the games and favorites are as they were, whatever else is written meanwhile
func TestSearchMatchesKeptUntilTheLibraryChanges(t *testing.T) {
	database := setup(t)
	scope := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner"}}
	narrow := SearchScope{Platforms: []string{"nes"}}
	first, _, err := FindSearchMatches(t.Context(), scope, narrow, "game")
	if err != nil || len(first) != 1 {
		t.Fatalf("found %d, %v", len(first), err)
	}
	// A game save is not a change to the library
	if _, err := database.Exec(`INSERT INTO game_saves (id, core, platform, rom_id, sha1, size, user_id, file_id, created_at, updated_at, status)
		VALUES ('g1', 'c', 'nes', 'rom1', 'x', 1, 'owner', 'f', 1, 1, 1)`); err != nil {
		t.Fatal(err)
	}
	if again, _, err := FindSearchMatches(t.Context(), scope, narrow, "game"); err != nil || &again[0] != &first[0] {
		t.Errorf("searched again after a game save: %v", err)
	}
	// A game added is
	if _, err := database.Exec(`INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id)
		VALUES ('Game 2.nes', 'nes', 2, 'rom3', 1, 1, 'roms/nes/c.nes', 'owner')`); err != nil {
		t.Fatal(err)
	}
	if again, _, err := FindSearchMatches(t.Context(), scope, narrow, "game"); err != nil || len(again) != 2 {
		t.Errorf("found %d after a game was added, %v; want 2", len(again), err)
	}
}
