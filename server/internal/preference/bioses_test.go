package preference

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"retroassembly/server/internal/db"
)

func TestMergeBioses(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	emulator := func(userID string) string {
		t.Helper()
		var value string
		if err := database.QueryRow(`SELECT coalesce(emulator, '') FROM user_preferences WHERE user_id = ?`, userID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}

	// The owner has a PlayStation BIOS. A friend has one of the same name, as other content, and an NES one; someone
	// else has only other settings
	_, err = database.Exec(`
		INSERT INTO user_preferences (emulator, input, ui, user_id, created_at, id, status, updated_at) VALUES
		('{"platform":{"psx":{"bioses":[{"fileId":"bioses/psx/a.bin","fileName":"scph5501.bin"}],"core":"pcsx_rearmed"}}}', NULL, NULL, 'owner', 1, 'p1', 1, 1),
		('{"platform":{"psx":{"bioses":[{"fileId":"bioses/psx/b.bin","fileName":"scph5501.bin"}]},"nes":{"bioses":[{"fileId":"bioses/nes/c.rom","fileName":"disksys.rom"}],"rewindEnabled":false}}}', NULL, NULL, 'friend', 2, 'p2', 1, 2),
		('{"platform":{"gb":{"core":"gambatte"}}}', NULL, NULL, 'other', 3, 'p3', 1, 3)`)
	if err != nil {
		t.Fatal(err)
	}

	brought, err := MergeBioses(ctx, database, "owner")
	if err != nil || brought != 1 {
		t.Fatalf("brought %d: %v", brought, err)
	}
	owner := emulator("owner")
	// The owner keeps their own of a name both had, gains the friend's other one, and keeps their other settings
	if !strings.Contains(owner, "bioses/psx/a.bin") || strings.Contains(owner, "bioses/psx/b.bin") ||
		!strings.Contains(owner, "bioses/nes/c.rom") || !strings.Contains(owner, "pcsx_rearmed") {
		t.Fatalf("the owner's: %s", owner)
	}
	// The friend's are dropped, with their other settings kept; nobody else's settings are touched
	if friend := emulator("friend"); strings.Contains(friend, "bioses") || !strings.Contains(friend, "rewindEnabled") {
		t.Fatalf("the friend's: %s", friend)
	}
	if other := emulator("other"); other != `{"platform":{"gb":{"core":"gambatte"}}}` {
		t.Fatalf("someone else's: %s", other)
	}

	if brought, err := MergeBioses(ctx, database, "owner"); err != nil || brought != 0 {
		t.Fatalf("again: brought %d: %v", brought, err)
	}
	if again := emulator("owner"); again != owner {
		t.Fatalf("the owner's changed the second time: %s", again)
	}
}

func TestMergeBiosesForAnOwnerWithoutSettings(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`
		INSERT INTO user_preferences (emulator, input, ui, user_id, created_at, id, status, updated_at) VALUES
		('{"platform":{"nes":{"bioses":[{"fileId":"bioses/nes/c.rom","fileName":"disksys.rom"}]}}}', NULL, NULL, 'friend', 2, 'p2', 1, 2)`)
	if err != nil {
		t.Fatal(err)
	}
	if brought, err := MergeBioses(context.Background(), database, "owner"); err != nil || brought != 1 {
		t.Fatalf("brought %d: %v", brought, err)
	}
	var owner string
	if err := database.QueryRow(`SELECT emulator FROM user_preferences WHERE user_id = 'owner'`).Scan(&owner); err != nil ||
		!strings.Contains(owner, "bioses/nes/c.rom") {
		t.Fatalf("the owner's: %s, %v", owner, err)
	}
}
