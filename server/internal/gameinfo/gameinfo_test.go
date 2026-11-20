package gameinfo

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	_ "modernc.org/sqlite"

	"retroassembly/server/internal/library"
	"retroassembly/server/internal/shared"
)

type fixtures struct {
	Again []struct {
		Input struct {
			FileName     string `json:"fileName"`
			LibretroName string `json:"libretroName"`
			Platform     string `json:"platform"`
		} `json:"input"`
		Result json.RawMessage `json:"result"`
	} `json:"again"`
	Lookups []struct {
		Input struct {
			Files []struct {
				MD5  string `json:"md5"`
				Name string `json:"name"`
			} `json:"files"`
			Platform string `json:"platform"`
		} `json:"input"`
		Result json.RawMessage `json:"result"`
	} `json:"lookups"`
	Names []struct {
		CompactName              string   `json:"compactName"`
		Countries                []string `json:"countries"`
		GoodcodesBase            string   `json:"goodcodesBase"`
		GoodcodesBaseCompactName string   `json:"goodcodesBaseCompactName"`
		Name                     string   `json:"name"`
		NameForLaunchbox         string   `json:"nameForLaunchbox"`
		Restored                 string   `json:"restored"`
	} `json:"names"`
	Queries []struct {
		Conditions []struct {
			LaunchboxID *int64  `json:"launchboxId"`
			LibretroID  *string `json:"libretroId"`
		} `json:"conditions"`
		Result json.RawMessage `json:"result"`
	} `json:"queries"`
	Schema struct {
		Indexes string `json:"indexes"`
		Tables  string `json:"tables"`
	} `json:"schema"`
	Statements []struct {
		SQL    string `json:"sql"`
		Values []any  `json:"values"`
	} `json:"statements"`
}

func load(t *testing.T) fixtures {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "typescript.json"))
	if err != nil {
		t.Fatal(err)
	}
	var loaded fixtures
	if err := json.Unmarshal(content, &loaded); err != nil {
		t.Fatal(err)
	}
	return loaded
}

// sameJSON compares a Go answer with the TypeScript one, as JSON
func sameJSON(t *testing.T, got any, want json.RawMessage) bool {
	t.Helper()
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(got); err != nil {
		t.Fatal(err)
	}
	var a, b any
	json.Unmarshal(buffer.Bytes(), &a)
	json.Unmarshal(want, &b)
	return reflect.DeepEqual(a, b)
}

func TestNames(t *testing.T) {
	for _, test := range load(t).Names {
		for _, check := range []struct {
			what      string
			got, want any
		}{
			{"compact name", CompactName(test.Name), test.CompactName},
			{"goodcodes base", GoodcodesBase(test.Name), test.GoodcodesBase},
			{"goodcodes compact", GoodcodesBaseCompactName(test.Name), test.GoodcodesBaseCompactName},
			{"restored", RestoreTitleForSorting(test.Name), test.Restored},
			{"countries", Countries(test.Name), test.Countries},
			{"for LaunchBox", NameForLaunchbox(test.Name), test.NameForLaunchbox},
		} {
			if !reflect.DeepEqual(check.got, check.want) {
				t.Errorf("%s of %q: %q, want %q", check.what, test.Name, check.got, check.want)
			}
		}
	}
}

func resultsJSON(results []Result) any {
	if results == nil {
		return nil
	}
	list := make([]library.Object, len(results))
	for i, result := range results {
		list[i] = library.Object{{Key: "launchbox", Value: nullable(result.Launchbox)}, {Key: "libretro", Value: nullable(result.Libretro)}}
	}
	return list
}

func nullable(object library.Object) any {
	if object == nil {
		return nil
	}
	return object
}

// The answers the TypeScript lookup gives, from the same small database (scripts/go-test-fixtures.ts, removed with the Node server)
func TestLookup(t *testing.T) {
	loaded := load(t)
	path := filepath.Join(t.TempDir(), "game-info.sqlite")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{loaded.Schema.Tables, loaded.Schema.Indexes} {
		if _, err := database.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range loaded.Statements {
		values := make([]any, len(statement.Values))
		for i, value := range statement.Values {
			if n, ok := value.(float64); ok && n == float64(int64(n)) {
				value = int64(n)
			}
			values[i] = value
		}
		if _, err := database.Exec(statement.SQL, values...); err != nil {
			t.Fatal(err)
		}
	}
	database.Close()

	data, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	info := &Database{Path: path, Platforms: data.GameInfoPlatforms}
	for _, test := range loaded.Lookups {
		files := make([]File, len(test.Input.Files))
		for i, file := range test.Input.Files {
			md5 := file.MD5
			files[i] = File{MD5: &md5, Name: file.Name}
		}
		results, err := info.Identify(files, test.Input.Platform)
		if err != nil || !sameJSON(t, resultsJSON(results), test.Result) {
			got, _ := json.Marshal(resultsJSON(results))
			t.Errorf("%s %+v: %v\n%s\nwant\n%s", test.Input.Platform, test.Input.Files, err, got, test.Result)
		}
	}
	for _, test := range loaded.Again {
		got := info.LaunchboxAgain(test.Input.FileName, test.Input.LibretroName, test.Input.Platform)
		if !sameJSON(t, nullable(got), test.Result) {
			t.Errorf("again %+v: %v, want %s", test.Input, got, test.Result)
		}
	}
	for _, test := range loaded.Queries {
		conditions := make([]Condition, len(test.Conditions))
		for i, condition := range test.Conditions {
			conditions[i] = Condition{LaunchboxID: condition.LaunchboxID, LibretroID: condition.LibretroID}
		}
		results, err := info.Query(conditions)
		if err != nil || !sameJSON(t, results, test.Result) {
			got, _ := json.Marshal(results)
			t.Errorf("query %+v: %v\n%s\nwant\n%s", test.Conditions, err, got, test.Result)
		}
	}

	// Without the database, nothing is found and nothing is wrong
	missing := &Database{Path: filepath.Join(t.TempDir(), "missing.sqlite"), Platforms: data.GameInfoPlatforms}
	if results, err := missing.Identify([]File{{Name: "Tetris.nes"}}, "nes"); results != nil || err != nil {
		t.Errorf("without the database: %v %v", results, err)
	}
}
