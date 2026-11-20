package search

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// What the TypeScript code answers for the same games and searches, written by scripts/go-test-fixtures.ts. The games
// are listed there too; here they're read back from the answers' ids
type fixtures struct {
	Normalize []struct {
		Result string `json:"result"`
		Text   string `json:"text"`
	} `json:"normalize"`
	Rank []struct {
		Query  string `json:"query"`
		Result []struct {
			ID    string  `json:"id"`
			Score float64 `json:"score"`
		} `json:"result"`
	} `json:"rank"`
	Score  []int `json:"score"`
	Titles []struct {
		FileName string `json:"fileName"`
		Result   string `json:"result"`
	} `json:"titles"`
}

// The games scripts/go-test-fixtures.ts ranks, in the same order: file name, platform, LaunchBox name, popularity,
// favorite
var games = []struct {
	fileName, platform, gameName string
	popularity                   float64
	favorite                     bool
}{
	{"Legend of Zelda, The - A Link to the Past (USA).sfc", "snes", "The Legend of Zelda: A Link to the Past", 900, true},
	{"Legend of Zelda, The (USA) (Rev 1).nes", "nes", "The Legend of Zelda", 700, false},
	{"Zelda II - The Adventure of Link (USA).nes", "nes", "Zelda II: The Adventure of Link", 400, false},
	{"Final Fantasy VII (USA) (Disc 1).cue", "psx", "Final Fantasy VII", 1000, false},
	{"Final Fantasy VI (Japan).sfc", "snes", "Final Fantasy VI", 300, false},
	{"Final Fantasy Tactics (USA).cue", "psx", "Final Fantasy Tactics", 500, true},
	{"Super Mario Bros. (World).nes", "nes", "Super Mario Bros.", 800, false},
	{"Super Mario 64 (USA).z64", "n64", "Super Mario 64", 950, false},
	{"Super Mario World (USA).sfc", "snes", "Super Mario World", 850, false},
	{"Dr. Mario (World).gb", "gb", "Dr. Mario", 200, false},
	{"Mario Kart 64 (USA).z64", "n64", "Mario Kart 64", 600, false},
	{"Spider-Man (USA).gba", "gba", "Spider-Man", 50, false},
	{"Pokemon - Red Version (USA, Europe).gb", "gb", "Pokémon Red Version", 700, false},
	{"Pokémon Stadium (USA).z64", "n64", "Pokémon Stadium", 300, false},
	{"Sonic the Hedgehog (World).md", "genesis", "Sonic the Hedgehog", 600, false},
	{"Sonic & Knuckles (World).md", "genesis", "Sonic & Knuckles", 300, false},
	{"sf2.zip", "arcade", "Street Fighter II: The World Warrior", 400, false},
	{"Street Fighter Alpha 3 (USA).cue", "psx", "Street Fighter Alpha 3", 200, false},
	{"Chrono Trigger (USA).sfc", "snes", "Chrono Trigger", 900, false},
	{"Tetris (World) (Rev 1).gb", "gb", "Tetris", 650, false},
	{"Q-bert (USA).nes", "nes", "Q*bert", 80, false},
	{"Pac-Man (USA).nes", "nes", "Pac-Man", 300, false},
	{"Ms. Pac-Man (USA).nes", "nes", "Ms. Pac-Man", 150, false},
	{"Mega Man 2 (USA).nes", "nes", "Mega Man 2", 500, false},
	{"Mega Man X (USA).sfc", "snes", "Mega Man X", 450, false},
	{"Kirby Super Star (USA).sfc", "snes", "", 0, false},
	{"Demo (Proto).gba", "gba", "", 0, false},
	{"Castlevania - Symphony of the Night (USA).cue", "psx", "Castlevania: Symphony of the Night", 700, false},
	{"Metroid Prime Hunters (USA).nds", "nds", "Metroid Prime: Hunters", 100, false},
	{"Über Racer (Europe).gba", "gba", "Über Racer", 3, false},
}

var credits = map[string][2]string{
	"Chrono Trigger (USA).sfc":    {"Square", "Square"},
	"Super Mario World (USA).sfc": {"Nintendo EAD", "Nintendo"},
	"Mega Man 2 (USA).nes":        {"Capcom", "Capcom"},
}

func candidates() []*Candidate {
	result := make([]*Candidate, len(games))
	for i, g := range games {
		gameTitle := ""
		if i == 26 {
			gameTitle = "My Own Demo"
		}
		credit := credits[g.fileName]
		result[i] = &Candidate{
			Game: Game{
				FileName: g.fileName, GameDeveloper: credit[0], GameName: g.gameName, GamePublisher: credit[1],
				GameTitle: gameTitle,
			},
			ID:         "g" + itoa(i),
			IsFavorite: g.favorite,
			Platform:   g.platform,
			Popularity: g.popularity,
			Title:      ShownTitle(gameTitle, g.platform, g.gameName, g.fileName),
		}
	}
	return result
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func load(t *testing.T) fixtures {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "typescript.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(content, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestNormalizeAndTitlesMatchTypeScript(t *testing.T) {
	f := load(t)
	for _, test := range f.Normalize {
		if got := NormalizeText(test.Text); got != test.Result {
			t.Errorf("NormalizeText(%q) = %q, TypeScript %q", test.Text, got, test.Result)
		}
	}
	for _, test := range f.Titles {
		if got := Title(test.FileName); got != test.Result {
			t.Errorf("Title(%q) = %q, TypeScript %q", test.FileName, got, test.Result)
		}
	}
}

func TestScoreMatchesTypeScript(t *testing.T) {
	f := load(t)
	i := 0
	for _, test := range f.Rank {
		for _, candidate := range candidates() {
			if got := Score(candidate.Game, test.Query); got != f.Score[i] {
				t.Errorf("Score(%s, %q) = %d, TypeScript %d", candidate.FileName, test.Query, got, f.Score[i])
			}
			i++
		}
	}
}

func TestRankMatchesTypeScript(t *testing.T) {
	f := load(t)
	for _, test := range f.Rank {
		got := Rank(candidates(), NormalizeQuery(test.Query))
		same := len(got) == len(test.Result)
		for i := 0; same && i < len(got); i++ {
			same = got[i].ID == test.Result[i].ID && math.Abs(got[i].Score()-test.Result[i].Score) < 1e-9
		}
		if !same {
			var gotIDs, wantIDs []string
			for _, c := range got {
				gotIDs = append(gotIDs, c.ID+":"+formatScore(c.Score()))
			}
			for _, w := range test.Result {
				wantIDs = append(wantIDs, w.ID+":"+formatScore(w.Score))
			}
			t.Errorf("Rank(%q):\nGo:         %v\nTypeScript: %v", test.Query, gotIDs, wantIDs)
		}
	}
}

func formatScore(score float64) string {
	b, _ := json.Marshal(math.Round(score*1000) / 1000)
	return string(b)
}
