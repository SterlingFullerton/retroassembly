package web

import (
	"testing"
	"time"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/library"
)

func TestSaveIsNewer(t *testing.T) {
	snapshotAt := time.Date(2026, 11, 28, 12, 0, 0, 0, time.UTC)
	state := &library.State{CreatedAt: auth.JSTime(snapshotAt)}
	browser := "a-browser-save"
	save := func(at time.Time, clientID *string) *library.GameSave {
		return &library.GameSave{ClientID: clientID, CreatedAt: auth.JSTime(at)}
	}
	cases := []struct {
		name string
		save *library.GameSave
		want bool
	}{
		{"no save", nil, false},
		{"a save from the server after the snapshot", save(snapshotAt.Add(time.Second), nil), true},
		{"a save from the server before the snapshot", save(snapshotAt.Add(-time.Second), nil), false},
		{"a browser's save made with its snapshot", save(snapshotAt.Add(2*time.Second), &browser), false},
		{"a browser's save well after the snapshot", save(snapshotAt.Add(10*time.Minute), &browser), true},
	}
	for _, c := range cases {
		if got := saveIsNewer(c.save, state); got != c.want {
			t.Errorf("%s: saveIsNewer = %v, want %v", c.name, got, c.want)
		}
	}
	if saveIsNewer(save(snapshotAt.Add(time.Hour), nil), nil) {
		t.Error("a game with no snapshot has no snapshot to start from instead")
	}
}
