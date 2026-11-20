package library

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/files"
)

func savesScope(t *testing.T, userID string) Scope {
	t.Helper()
	storage := t.TempDir()
	c := config.Config{Directories: config.Directories{
		Attachments: filepath.Join(storage, "attachments"),
		Bioses:      filepath.Join(storage, "bioses"),
		GameSaves:   filepath.Join(storage, "game-saves"),
		Roms:        filepath.Join(storage, "roms"),
		States:      filepath.Join(storage, "states"),
		Storage:     storage,
	}}
	return Scope{
		Database:       setup(t),
		LibraryOwnerID: "owner",
		MaxAutoStates:  2,
		Storage:        files.Storage{Path: c.FilePath},
		User:           &auth.User{ID: userID},
	}
}

func countFiles(t *testing.T, scope Scope, kind string) int {
	t.Helper()
	folder, _ := scope.Storage.Path(kind + "/x")
	count := 0
	filepath.Walk(filepath.Dir(folder), func(_ string, info os.FileInfo, err error) error {
		if err == nil && info.Mode().IsRegular() {
			count++
		}
		return nil
	})
	return count
}

func TestStates(t *testing.T) {
	ctx := context.Background()
	scope := savesScope(t, "owner")
	clientID := "c1"
	manual, err := CreateState(ctx, scope, NewState{ClientID: &clientID, Core: "fceumm", Rom: "rom1", State: []byte("s"), Thumbnail: []byte("t"), Type: "manual"})
	if err != nil || manual.Platform != "nes" || *manual.ClientID != "c1" {
		t.Fatalf("create: %+v, %v", manual, err)
	}
	again, err := CreateState(ctx, scope, NewState{ClientID: &clientID, Core: "fceumm", Rom: "rom1", State: []byte("other"), Thumbnail: []byte("t"), Type: "manual"})
	if err != nil || again.ID != manual.ID {
		t.Fatalf("the same client id is the same save: %+v, %v", again, err)
	}
	for range 4 {
		if _, err := CreateState(ctx, scope, NewState{Core: "fceumm", Rom: "rom1", State: []byte("a"), Thumbnail: []byte("t"), Type: "auto"}); err != nil {
			t.Fatal(err)
		}
	}
	auto, err := GetStates(ctx, scope, StatesQuery{Rom: "rom1", Type: "auto"})
	if err != nil || len(auto) != 2 {
		t.Fatalf("2 automatic saves are kept: %d, %v", len(auto), err)
	}
	all, _ := GetStates(ctx, scope, StatesQuery{Rom: "rom1", Type: "any"})
	if len(all) != 3 || countFiles(t, scope, "states") != 6 {
		t.Fatalf("%d saves and %d files, want 3 and 6", len(all), countFiles(t, scope, "states"))
	}

	var known *failure.Error
	stranger := scope
	stranger.User = &auth.User{ID: "stranger"}
	if err := DeleteState(ctx, stranger, manual.ID); !errors.As(err, &known) || known.Status != 404 {
		t.Fatalf("someone else's save is not found: %v", err)
	}
	if err := DeleteState(ctx, scope, manual.ID); err != nil {
		t.Fatal(err)
	}
	if countFiles(t, scope, "states") != 4 {
		t.Fatal("a deleted save's files are deleted")
	}
	if _, err := GetStates(ctx, scope, StatesQuery{Rom: "nope", Type: "manual"}); !errors.As(err, &known) || known.Status != 404 {
		t.Fatalf("a game not in the library: %v", err)
	}
}

func TestGameSaves(t *testing.T) {
	ctx := context.Background()
	scope := savesScope(t, "owner")
	save := func(content string, fileType *string) *GameSave {
		t.Helper()
		saved, err := CreateGameSave(ctx, scope, NewGameSave{Content: []byte(content), Core: "fceumm", FileType: fileType, Rom: "rom1"})
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	first := save("v0", nil)
	if unchanged := save("v0", nil); unchanged.ID != first.ID {
		t.Fatal("a save the same as the latest isn't kept again")
	}
	for i := 1; i <= 11; i++ {
		save(string(rune('a'+i)), nil)
	}
	versions, err := ListGameSaves(ctx, scope, "fceumm", "rom1")
	if err != nil || len(versions) != keptGameSaveVersions || countFiles(t, scope, "game-saves") != keptGameSaveVersions {
		t.Fatalf("%d versions, %d files, %v", len(versions), countFiles(t, scope, "game-saves"), err)
	}
	dsv, odd := "dsv", "A.B"
	if saved := save("ds", &dsv); filepath.Ext(saved.FileID) != ".dsv" {
		t.Fatalf("file type dsv: %s", saved.FileID)
	}
	if saved := save("odd", &odd); filepath.Ext(saved.FileID) != ".srm" {
		t.Fatalf("an odd file type is srm: %s", saved.FileID)
	}

	versions, _ = ListGameSaves(ctx, scope, "fceumm", "rom1")
	oldest := versions[len(versions)-1]
	restored, err := RestoreGameSave(ctx, scope, oldest.ID)
	if err != nil || restored.Sha1 != oldest.Sha1 || restored.ID == oldest.ID {
		t.Fatalf("restoring copies the version to the top: %+v, %v", restored, err)
	}
	latest, _ := LatestGameSave(ctx, scope, "fceumm", "rom1")
	if latest.ID != restored.ID {
		t.Fatal("the restored version is the latest")
	}
	if again, _ := RestoreGameSave(ctx, scope, latest.ID); again.ID != latest.ID {
		t.Fatal("restoring the version in use changes nothing")
	}
	stranger := scope
	stranger.User = &auth.User{ID: "stranger"}
	var known *failure.Error
	if _, err := RestoreGameSave(ctx, stranger, latest.ID); !errors.As(err, &known) || known.Status != 404 {
		t.Fatalf("someone else's save is not found: %v", err)
	}
}
