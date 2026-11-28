package library

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/files"
)

// The answers parseDisc gives (scripts/go-test-fixtures.ts, removed with the Node server)
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

func TestMergeDiscGroupLeavesOtherGamesAlone(t *testing.T) {
	database := setup(t)
	_, err := database.Exec(`
		INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id, disc_group, disc_number) VALUES
			('FF7 (Disc 1).cue', 'psx', 1, 'ff1', 1, 1, 'roms/psx/1.cue', 'u1', 'FF7', 1),
			('FF7 (Disc 2).cue', 'psx', 2, 'ff2', 1, 1, 'roms/psx/2.cue', 'u1', 'FF7', 2),
			('MGS (Disc 1).cue', 'psx', 3, 'mgs1', 1, 1, 'roms/psx/3.cue', 'u1', 'MGS', 1),
			('MGS (Disc 2).cue', 'psx', 4, 'mgs2', 1, 1, 'roms/psx/4.cue', 'u1', 'MGS', 2);
		INSERT INTO launch_records (id, core, platform, rom_id, user_id, created_at, updated_at, status)
			VALUES ('l1', 'c', 'psx', 'ff2', 'u1', 1, 1, 1), ('l2', 'c', 'psx', 'mgs2', 'u1', 1, 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := MergeDiscGroup(t.Context(), database, DiscGroup{UserID: "u1", Platform: "psx", Group: "FF7"}); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := database.QueryRow(`SELECT group_concat(rom_id, ' ') FROM (SELECT rom_id FROM launch_records ORDER BY id)`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "ff1 mgs2" {
		t.Errorf("history is on %q, want the first game's moved to its disc 1 and the other left", got)
	}
}

// Deleting a game on several discs deletes every disc, so no other disc stands for it without everyone's saves
func TestDeleteRomsDeletesEveryDisc(t *testing.T) {
	database := setup(t)
	_, err := database.Exec(`
		INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id, disc_group, disc_number) VALUES
			('FF7 (Disc 1).cue', 'psx', 1, 'ff1', 1, 1, 'roms/psx/1.cue', 'owner', 'FF7', 1),
			('FF7 (Disc 2).cue', 'psx', 2, 'ff2', 1, 1, 'roms/psx/2.cue', 'owner', 'FF7', 2),
			('MGS (Disc 1).cue', 'psx', 3, 'mgs1', 1, 1, 'roms/psx/3.cue', 'owner', 'MGS', 1),
			('FF7 (Disc 1).cue', 'saturn', 4, 'saturn', 1, 1, 'roms/saturn/1.cue', 'owner', 'FF7', 1)`)
	if err != nil {
		t.Fatal(err)
	}
	folder := t.TempDir()
	scope := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner", Role: auth.RoleAdmin},
		Storage: files.Storage{Path: func(id string) (string, bool) { return filepath.Join(folder, filepath.FromSlash(id)), true }}}
	if err := DeleteRoms(t.Context(), scope, []string{"ff1"}); err != nil {
		t.Fatal(err)
	}
	var live string
	if err := database.QueryRow(`SELECT group_concat(id, ' ') FROM (SELECT id FROM roms WHERE status = 1 ORDER BY id)`).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != "mgs1 rom1 saturn" {
		t.Errorf("games left are %q, want both discs of FF7 gone and the rest kept", live)
	}
}

// A game deleted and uploaded again has everyone's saves, save states and favorites back
func TestSaveUploadedRomBringsBackADeletedGamesSaves(t *testing.T) {
	database := setup(t)
	_, err := database.Exec(`
		INSERT INTO roms (file_name, platform, created_at, id, status, updated_at, file_id, user_id) VALUES
			('Crash.cue', 'psx', 1, 'old1', 0, 1, 'roms/psx/1.cue', 'owner'),
			('Crash.cue', 'psx', 2, 'old2', 0, 1, 'roms/psx/1.cue', 'owner'),
			('Crash.cue', 'psx', 3, 'theirs', 0, 1, 'roms/psx/1.cue', 'contributor');
		INSERT INTO states (id, core, platform, rom_id, thumbnail_file_id, type, user_id, file_id, created_at, updated_at, status)
			VALUES ('s1', 'c', 'psx', 'old1', 't', 'manual', 'u1', 'f', 1, 1, 1),
			       ('s2', 'c', 'psx', 'theirs', 't', 'manual', 'u1', 'f', 1, 1, 1);
		INSERT INTO game_saves (id, core, platform, rom_id, sha1, size, user_id, file_id, created_at, updated_at, status)
			VALUES ('g1', 'c', 'psx', 'old2', 'x', 1, 'u1', 'f', 1, 1, 1);
		INSERT INTO favorites (id, rom_id, user_id, created_at, updated_at, status)
			VALUES ('f1', 'old1', 'u1', 1, 1, 1), ('f2', 'old2', 'u1', 1, 1, 1), ('f3', 'old2', 'u2', 1, 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	scope := Scope{Database: database, LibraryOwnerID: "owner", User: &auth.User{ID: "owner", Role: auth.RoleAdmin}}
	rom, _, err := SaveUploadedRom(t.Context(), scope, "psx", "Crash.cue", []RomField{
		{"file_id", "roms/psx/2.cue"}, {"file_name", "Crash.cue"}, {"platform", "psx"}, {"user_id", "owner"},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _ := rom.Get("id").(string)
	for _, check := range []struct{ query, want string }{
		{`SELECT group_concat(id || ':' || (rom_id = ?1), ' ') FROM (SELECT * FROM states ORDER BY id)`, "s1:1 s2:0"},
		{`SELECT group_concat(id || ':' || (rom_id = ?1), ' ') FROM (SELECT * FROM game_saves ORDER BY id)`, "g1:1"},
		{`SELECT group_concat(user_id || ':' || (rom_id = ?1), ' ') FROM (SELECT * FROM favorites ORDER BY user_id)`, "u1:1 u2:1"},
	} {
		var got string
		if err := database.QueryRow(check.query, id).Scan(&got); err != nil || got != check.want {
			t.Errorf("%s\n%q %v, want %q", check.query, got, err, check.want)
		}
	}
}
