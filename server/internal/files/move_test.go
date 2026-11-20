package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMoveFolderContents(t *testing.T) {
	from, to := filepath.Join(t.TempDir(), "attachments"), t.TempDir()
	for name, content := range map[string]string{"a/1.png": "one", "a/b/2.png": "two", "3.png": "three"} {
		os.MkdirAll(filepath.Dir(filepath.Join(from, name)), 0o755)
		os.WriteFile(filepath.Join(from, name), []byte(content), 0o644)
	}
	// One already there stays where it was
	os.WriteFile(filepath.Join(to, "3.png"), []byte("kept"), 0o644)
	moved, err := MoveFolderContents(from, to)
	if err != nil || moved != 2 {
		t.Fatalf("%d moved, %v", moved, err)
	}
	for name, want := range map[string]string{"a/1.png": "one", "a/b/2.png": "two", "3.png": "kept"} {
		if content, _ := os.ReadFile(filepath.Join(to, name)); string(content) != want {
			t.Errorf("%s: %q", name, content)
		}
	}
	if _, err := os.Stat(filepath.Join(from, "a")); err == nil {
		t.Error("empty folders left behind")
	}
	if _, err := os.Stat(filepath.Join(from, "3.png")); err != nil {
		t.Error("the file that wasn't moved is gone")
	}
	if moved, err := MoveFolderContents(filepath.Join(t.TempDir(), "missing"), to); moved != 0 || err != nil {
		t.Errorf("missing folder: %d %v", moved, err)
	}
}
