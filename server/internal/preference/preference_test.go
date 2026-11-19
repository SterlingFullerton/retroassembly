package preference

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"retroassembly/server/internal/shared"
)

// What the TypeScript code answers for the same inputs, written by scripts/go-test-fixtures.ts
type fixtures struct {
	Merge []struct {
		Result any `json:"result"`
		Source any `json:"source"`
		Target any `json:"target"`
	} `json:"merge"`
	Resolve []struct {
		Input  any `json:"input"`
		Result any `json:"result"`
	} `json:"resolve"`
}

func loadFixtures(t *testing.T) (map[string]any, *Settings) {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "typescript.json"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(content)
	if err != nil {
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
	return decoded.(Object), settings
}

func TestMergeMatchesTypeScript(t *testing.T) {
	all, _ := loadFixtures(t)
	for i, item := range all["merge"].([]any) {
		test := item.(Object)
		got := Merge(test["target"].(Object), test["source"].(Object))
		// Compared as JSON, where a missing key and its absence are the same
		if string(Encode(got)) != string(Encode(test["result"])) {
			t.Errorf("merge %d:\nGo:         %s\nTypeScript: %s", i, Encode(got), Encode(test["result"]))
		}
	}
}

func TestResolveMatchesTypeScript(t *testing.T) {
	all, settings := loadFixtures(t)
	for i, item := range all["resolve"].([]any) {
		test := item.(Object)
		input, _ := test["input"].(Object)
		got := settings.Resolve(input)
		if !reflect.DeepEqual(roundTrip(t, got), roundTrip(t, test["result"])) {
			t.Errorf("resolve %d (%s):\nGo:         %s\nTypeScript: %s", i, Encode(test["input"]), Encode(got), Encode(test["result"]))
		}
	}
}

func roundTrip(t *testing.T, value any) any {
	t.Helper()
	decoded, err := Decode(Encode(value))
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestResolveLeavesInputAlone(t *testing.T) {
	_, settings := loadFixtures(t)
	input := Object{"ui": Object{"platforms": nil}}
	settings.Resolve(input)
	if _, ok := input["ui"].(Object)["platforms"]; !ok {
		t.Error("Resolve changed the settings it was given")
	}
}

func TestNormalize(t *testing.T) {
	_, settings := loadFixtures(t)
	preference := Object{"ui": Object{"platforms": []any{"snes", "nes", "not-a-console", "gba"}}}
	settings.normalize(preference)
	got := preference["ui"].(Object)["platforms"]
	want := []any{"gba", "nes", "snes"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("normalize: %v, want %v", got, want)
	}
	cleared := Object{"ui": Object{"platforms": nil}}
	settings.normalize(cleared)
	if _, ok := cleared["ui"].(Object)["platforms"]; ok {
		t.Error("a null list of consoles should be removed")
	}
}
