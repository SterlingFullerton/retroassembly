package library

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The answers parseDisc gives (scripts/go-test-fixtures.ts)
func TestParseDisc(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("testdata", "discs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		FileName string `json:"fileName"`
		Result   *struct {
			Group  string  `json:"group"`
			Number float64 `json:"number"`
		} `json:"result"`
	}
	if err := json.Unmarshal(content, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		group, number, ok := ParseDisc(test.FileName)
		if ok != (test.Result != nil) || ok && (group != test.Result.Group || number != test.Result.Number) {
			t.Errorf("%q: %q %v %v, want %+v", test.FileName, group, number, ok, test.Result)
		}
	}
}

func TestUpdateDiscGroups(t *testing.T) {
	database := setup(t)
	_, err := database.Exec(`
		INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id) VALUES
			('FF7 (USA) (Disc 2).cue', 'psx', 1, 'ff2', 1, 1, 'roms/psx/2.cue', 'u1'),
			('FF7 (USA) (Disc 1).cue', 'psx', 2, 'ff1', 1, 1, 'roms/psx/1.cue', 'u1'),
			('FF7 (USA) (Disc 3).cue', 'psx', 3, 'ff3', 1, 1, 'roms/psx/3.cue', 'u1'),
			('FF7 (USA) (Disc 1).cue', 'psx', 4, 'other1', 1, 1, 'roms/psx/o.cue', 'u2'),
			('Old (Disc 1).cue', 'psx', 5, 'gone', 0, 1, 'roms/psx/g.cue', 'u1'),
			('Tekken 3 (USA).cue', 'psx', 6, 'single', 1, 1, 'roms/psx/t.cue', 'u1'),
			('Game (Disc 1).nes', 'nes', 7, 'nes', 1, 1, 'roms/nes/g.nes', 'u1');
		INSERT INTO states (id, core, platform, rom_id, thumbnail_file_id, type, user_id, file_id, created_at, updated_at, status, disc)
			VALUES ('s2', 'c', 'psx', 'ff2', 't', 'manual', 'u1', 'f', 1, 1, 1, NULL),
			       ('s3', 'c', 'psx', 'ff3', 't', 'manual', 'u1', 'f', 1, 1, 1, 1);
		INSERT INTO launch_records (id, core, platform, rom_id, user_id, created_at, updated_at, status)
			VALUES ('l3', 'c', 'psx', 'ff3', 'u1', 1, 1, 1);
		INSERT INTO game_saves (id, core, platform, rom_id, sha1, size, user_id, file_id, created_at, updated_at, status)
			VALUES ('g2', 'c', 'psx', 'ff2', 'x', 1, 'u1', 'f', 1, 1, 1);
		INSERT INTO favorites (id, rom_id, user_id, created_at, updated_at, status)
			VALUES ('f1', 'ff1', 'u1', 1, 1, 1), ('f2', 'ff2', 'u1', 1, 1, 1), ('f3', 'ff3', 'u3', 1, 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := UpdateDiscGroups(t.Context(), database, []string{"psx"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct {
		query string
		want  string
	}{
		{`SELECT group_concat(id || ':' || coalesce(disc_group, '-') || ':' || coalesce(disc_number, '-'), ' ') FROM (SELECT * FROM roms ORDER BY id)`,
			"ff1:FF7 (USA):1 ff2:FF7 (USA):2 ff3:FF7 (USA):3 gone:Old:1 nes:-:- other1:FF7 (USA):1 rom1:-:- rom2:-:- single:-:-"},
		{`SELECT group_concat(id || ':' || rom_id || ':' || coalesce(disc, '-'), ' ') FROM (SELECT * FROM states ORDER BY id)`, "s2:ff1:2 s3:ff1:1"},
		{`SELECT group_concat(rom_id) FROM launch_records`, "ff1"},
		{`SELECT group_concat(rom_id) FROM game_saves`, "ff1"},
		{`SELECT group_concat(id || ':' || rom_id || ':' || user_id, ' ') FROM (SELECT * FROM favorites ORDER BY id)`, "f1:ff1:u1 f3:ff1:u3"},
	} {
		var got string
		if err := database.QueryRow(check.query).Scan(&got); err != nil || got != check.want {
			t.Errorf("%s\n%q %v, want %q", check.query, got, err, check.want)
		}
	}
}
