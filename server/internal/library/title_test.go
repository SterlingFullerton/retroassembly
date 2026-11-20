package library

import (
	"encoding/json"
	"testing"
)

// What the TypeScript getRomGoodcodes(rom).rom gives each
func TestRomTitle(t *testing.T) {
	cases := []struct {
		fileName, platform, rawGameMetadata, gameTitle, want string
	}{
		{"Legend of Zelda, The - Link's Awakening (USA) [!].gb", "gb", "", "", "The Legend of Zelda - Link's Awakening"},
		{"Super Mario Bros. (World).nes", "nes", "", "", "Super Mario Bros."},
		{"Final Fantasy VII (USA) (Disc 1).cue", "psx", "", "", "Final Fantasy VII"},
		{"sf2.zip", "arcade", `{"libretro":{"name":"Street Fighter II: The World Warrior (World 910522)"}}`, "", "Street Fighter II: The World Warrior"},
		{"sf2.zip", "arcade", "", "", "sf2"},
		{"Game, A (Europe).sfc", "snes", "", "", "A Game"},
		{"Thing, An - Story (USA).sfc", "snes", "", "", "An Thing - Story"},
		{"Dr. Mario (World).gb", "gb", "", "  My Doctor  ", "My Doctor"},
		{"01 - Track (Japan).nes", "nes", "", "", "01 - Track"},
		{"Name [b1] (Hack) [T+Eng].nes", "nes", "", "", "Name"},
		{"Spaced  .v1 .nes", "nes", "", "", "Spaced  "},
		{".hidden", "nes", "", "", ""},
		{"Mega Man X, The (USA)", "snes", "", "", "The Mega Man X"},
		{"Pokémon - Red Version (USA, Europe).gb", "gb", "", "", "Pokémon - Red Version"},
	}
	for _, test := range cases {
		rom := Object{{"fileName", test.fileName}, {"platform", test.platform}}
		if test.rawGameMetadata != "" {
			rom = append(rom, Field{"rawGameMetadata", json.RawMessage(test.rawGameMetadata)})
		}
		if test.gameTitle != "" {
			rom = append(rom, Field{"gameTitle", test.gameTitle})
		}
		if got := RomTitle(rom); got != test.want {
			t.Errorf("RomTitle(%q) = %q, TypeScript %q", test.fileName, got, test.want)
		}
	}
}
