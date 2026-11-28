package preference

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/shared"
)

// Settings saved at the same time are each merged over the other, so none is lost
func TestUpdatesAtOnceAreAllKept(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, filepath.Join("..", "..", "..", "src", "databases", "migrations")); err != nil {
		t.Fatal(err)
	}
	data, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	settings, err := New(data.DefaultPreference, data.Platforms)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for index := range 8 {
		group.Go(func() {
			snippet := Object{"input": Object{fmt.Sprintf("key%d", index): "x"}}
			if _, err := settings.Update(context.Background(), database, "owner", "owner", snippet); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	var input string
	var rows int
	if err := database.QueryRow(`SELECT count(*), coalesce(max(input), '') FROM user_preferences`).Scan(&rows, &input); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("%d rows of settings, want 1", rows)
	}
	for index := range 8 {
		if !strings.Contains(input, fmt.Sprintf("key%d", index)) {
			t.Errorf("key%d was lost: %s", index, input)
		}
	}
}
