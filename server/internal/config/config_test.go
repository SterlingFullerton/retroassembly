package config

import (
	"path/filepath"
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
