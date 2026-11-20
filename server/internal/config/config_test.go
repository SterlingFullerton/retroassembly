package config

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFilePath(t *testing.T) {
	c := Config{Directories: Directories{
		Attachments: "/art/attachments",
		Bioses:      "/storage/bioses",
		GameSaves:   "/storage/game-saves",
		Roms:        "/games",
		States:      "/storage/states",
		Storage:     "/storage",
	}}
	cases := []struct {
		id   string
		want string
		ok   bool
	}{
		// What the Node server's getFilePath answers for each, with the same folders
		{"roms/nes/abc.nes", "/games/nes/abc.nes", true},
		{"attachments/u1/nes/r1/x.png", "/art/attachments/u1/nes/r1/x.png", true},
		{"states/u1/x.state", "/storage/states/u1/x.state", true},
		{"other/file.txt", "/storage/other/file.txt", true},
		{"roms/../../retroassembly.sqlite", "", false},
		{"roms/nes/../../../retroassembly.sqlite", "", false},
		{"../retroassembly.sqlite", "", false},
		{"/etc/passwd", "", false},
		{"roms/", "", false},
		{"roms", "/storage/roms", true},
		{"", "", false},
		{"roms/..x", "", false},
		{"./roms/nes/a.nes", "/games/nes/a.nes", true},
		{"roms//nes/a.nes", "/games/nes/a.nes", true},
		{"bioses/../roms/x", "/games/x", true},
		{"storage/../x", "/storage/x", true},
	}
	for _, test := range cases {
		got, ok := c.FilePath(test.id)
		if ok != test.ok || (ok && got != filepath.FromSlash(test.want)) {
			t.Errorf("FilePath(%q) = %q, %v; want %q, %v", test.id, got, ok, test.want, test.ok)
		}
	}
}

func TestAuthMode(t *testing.T) {
	if mode, err := (Config{}).AuthMode(); mode != "local" || err != nil {
		t.Errorf("no OIDC: %q, %v", mode, err)
	}
	if mode, err := (Config{OIDC: OIDC{ClientID: "a", ClientSecret: "b", Issuer: "c"}}).AuthMode(); mode != "oidc" || err != nil {
		t.Errorf("OIDC: %q, %v", mode, err)
	}
	if _, err := (Config{OIDC: OIDC{Issuer: "c"}}).AuthMode(); err == nil {
		t.Error("part of OIDC set should be an error")
	}
}

func TestJSNumber(t *testing.T) {
	for value, want := range map[string]int{
		"8080": 8080, " 8080 ": 8080, "8080.9": 8080, "8e3": 8000, "0x1f40": 8000, "010": 10, "": 0, "abc": 0,
		"80 80": 0, "1_000": 0, "Infinity": 0,
	} {
		if got := jsNumber(value); got != want {
			t.Errorf("jsNumber(%q) = %d, want %d", value, got, want)
		}
	}
}

// Each setting is read by its short name, or by its old name when only that is set; the short name wins when both are
func TestSettingNames(t *testing.T) {
	t.Setenv("ROMS_DIR", "/games")
	t.Setenv("RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY", "/old-games")
	t.Setenv("RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY", "/old-states")
	t.Setenv("RETROASSEMBLY_RUN_TIME_MAX_AUTO_STATES_PER_ROM", "5")
	t.Setenv("CDN_CACHE", "true")
	t.Setenv("RETROASSEMBLY_RUN_TIME_PORT", "9000")
	t.Setenv("OIDC_SCOPES", "")
	t.Setenv("RETROASSEMBLY_RUN_TIME_OIDC_SCOPES", "openid")
	c := Load()
	if c.Directories.Roms != "/games" {
		t.Errorf("Roms = %q, want the short name's /games", c.Directories.Roms)
	}
	if c.Directories.States != "/old-states" {
		t.Errorf("States = %q, want the old name's /old-states", c.Directories.States)
	}
	if c.MaxAutoStatesPerRom != 5 || !c.CDNCache || c.Port != 9000 {
		t.Errorf("MaxAutoStatesPerRom %d, CDNCache %v, Port %d; want 5, true, 9000", c.MaxAutoStatesPerRom, c.CDNCache, c.Port)
	}
	// Set to nothing by its short name is still set, as before with the old name alone
	if c.OIDC.Scopes != "" {
		t.Errorf("Scopes = %q, want empty", c.OIDC.Scopes)
	}
	for name, old := range Names {
		if !strings.HasPrefix(old, "RETROASSEMBLY_") || strings.HasPrefix(name, "RETROASSEMBLY_") {
			t.Errorf("%s: old name %s", name, old)
		}
	}
	for name := range DirectorySettings {
		if _, known := Names[name]; !known {
			t.Errorf("directory setting %s has no entry in Names", name)
		}
	}
}

func TestRecheckDays(t *testing.T) {
	for value, want := range map[string]float64{"": 30, "0": 0, "7": 7, " 365 ": 365, "-1": 30, "never": 30, "1.5": 1.5} {
		if got := recheckDays(value); got != want {
			t.Errorf("recheckDays(%q) = %v, want %v", value, got, want)
		}
	}
}
