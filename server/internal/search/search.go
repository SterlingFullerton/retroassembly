// Package search finds games by name as src/utils/isomorphic/search.ts and src/controllers/roms/search-roms.ts do:
// every word typed has to start a word of the game's name, and when no name has them all, a typo-tolerant match as
// Fuse.js makes it.
package search

import (
	"bytes"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf16"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// JavaScript's \s, which also takes no-break and other Unicode spaces
const jsSpace = `\s\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}\v`

var (
	nonWord         = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	apostrophes     = regexp.MustCompile("['’`]")
	extension       = regexp.MustCompile(`\.[^.` + jsSpace + `]{1,5}$`)
	bracketedTags   = regexp.MustCompile(`[` + jsSpace + `]*[(\[][^)\]]*[)\]]`)
	trailingArticle = regexp.MustCompile(`(?i)^([^,]+), (The|A|An)\b`)
	digits          = regexp.MustCompile(`^\d+$`)
)

func isJSSpace(r rune) bool {
	return unicode.IsSpace(r) || r == 0xfeff
}

func jsTrim(text string) string {
	return strings.TrimFunc(text, isJSSpace)
}

// length is a string's length as JavaScript counts it, in UTF-16 code units
func length(text string) int {
	return len(utf16.Encode([]rune(text)))
}

// NormalizeText is lowercase words without accents or punctuation: "Pokémon: Let's Go & Fly!" is "pokemon lets go and
// fly"
func NormalizeText(text string) string {
	decomposed := norm.NFKD.String(text)
	stripped := strings.Map(func(r rune) rune {
		if unicode.Is(unicode.M, r) {
			return -1
		}
		return r
	}, decomposed)
	lower := strings.ToLower(stripped)
	lower = strings.ReplaceAll(lower, "&", " and ")
	lower = apostrophes.ReplaceAllString(lower, "")
	lower = nonWord.ReplaceAllString(lower, " ")
	return jsTrim(lower)
}

// Title is a file's name as the library shows it: no extension, region or other tags in brackets
func Title(fileName string) string {
	return titles.get(fileName, title)
}

func title(fileName string) string {
	base := extension.ReplaceAllString(fileName, "")
	if title := jsTrim(bracketedTags.ReplaceAllString(base, "")); title != "" {
		return title
	}
	return base
}

var romanNumerals = map[string]string{
	"ii": "2", "iii": "3", "iv": "4", "ix": "9", "v": "5", "vi": "6", "vii": "7", "viii": "8", "xi": "11", "xii": "12",
	"xiii": "13",
}

type prepared struct {
	compact  string
	initials string
	// The text with a space before it, to find the words typed at the start of one of its words
	spaced string
	text   string
	words  []string
}

// prepare is a name ready to be compared with what's typed. A search compares every game's names, so each is prepared
// once and kept: the result depends on the text alone
func prepare(text string) *prepared {
	if text == "" {
		return nil
	}
	return preparedNames.get(text, prepareText)
}

func prepareText(text string) *prepared {
	// "Legend of Zelda, The - A Link to the Past" is read as "The Legend of Zelda - A Link to the Past"
	normalized := NormalizeText(trailingArticle.ReplaceAllString(text, "$2 $1"))
	if normalized == "" {
		return nil
	}
	words := strings.Split(normalized, " ")
	all := append([]string{}, words...)
	var initials strings.Builder
	for _, word := range words {
		// A Roman numeral also matches its number, so "final fantasy 7" finds "Final Fantasy VII"
		if number, ok := romanNumerals[word]; ok {
			all = append(all, number)
			initials.WriteString(number)
			continue
		}
		// First letters, with numbers whole: "ff7" finds "Final Fantasy VII", "sm64" finds "Super Mario 64"
		if digits.MatchString(word) {
			initials.WriteString(word)
		} else {
			initials.WriteString(string(utf16.Decode(utf16.Encode([]rune(word))[:1])))
		}
	}
	return &prepared{
		compact: strings.ReplaceAll(normalized, " ", ""), initials: initials.String(), spaced: " " + normalized,
		text: normalized, words: all,
	}
}

// Tiers of how a name matches. Within a tier, better-known games come first
func scoreText(target, query *prepared) int {
	if target.text == query.text {
		return 100
	}
	// The words typed, together, at the start of a word of the name
	if strings.Contains(target.spaced, query.spaced) {
		return 80
	}
	// Every word typed starts a word of the name, in any order
	every := true
	for _, word := range query.words {
		found := false
		for _, targetWord := range target.words {
			if strings.HasPrefix(targetWord, word) {
				found = true
				break
			}
		}
		if !found {
			every = false
			break
		}
	}
	if every {
		return 60
	}
	if len(query.words) == 1 && length(query.compact) > 2 {
		if strings.HasPrefix(target.initials, query.compact) {
			return 55
		}
		// Without spaces: "spiderman" finds "Spider-Man", "mario64" finds "Mario 64"
		if strings.Contains(target.compact, query.compact) {
			return 50
		}
	}
	return 0
}

// Game is what search knows of a game
type Game struct {
	FileName      string
	GameDeveloper string
	GameName      string
	GamePublisher string
	GameTitle     string
}

// Score is how well a game matches a search, from 0 (not at all) to 100 (its exact name). Its name counts most; the
// developer or publisher only when every word typed is found there
func Score(game Game, query string) int {
	preparedQuery := prepareText(query)
	if preparedQuery == nil {
		return 0
	}
	return score(game, preparedQuery)
}

func score(game Game, preparedQuery *prepared) int {
	fileTitle := ""
	if game.FileName != "" {
		fileTitle = Title(game.FileName)
	}
	score := 0
	for _, name := range []string{fileTitle, game.GameName, game.GameTitle} {
		if target := prepare(name); target != nil {
			score = max(score, scoreText(target, preparedQuery))
		}
	}
	if score == 0 {
		for _, credit := range []string{game.GameDeveloper, game.GamePublisher} {
			if target := prepare(credit); target != nil && scoreText(target, preparedQuery) >= 60 {
				return 30
			}
		}
	}
	return score
}

// NormalizeQuery is a search as typed, without spaces around it or more than one between words
func NormalizeQuery(query string) string {
	return strings.Join(strings.FieldsFunc(query, isJSSpace), " ")
}

// Candidate is a game a search ranks
type Candidate struct {
	Game
	ID         string
	IsFavorite bool
	Platform   string
	// How many people rated the game on LaunchBox
	Popularity float64
	// The name the library shows it under
	Title string

	score float64
}

// Score is how well the candidate matched, once ranked
func (c *Candidate) Score() float64 {
	return c.score
}

// ShownTitle is the name the library shows a game under: its own, or for arcade games, whose files are named like
// "sf2.zip", its game's name
func ShownTitle(gameTitle, platform, gameName, fileName string) string {
	if gameTitle != "" {
		return gameTitle
	}
	if platform == "arcade" && gameName != "" {
		return gameName
	}
	return Title(fileName)
}

// A collator sorts as the browser's localeCompare does. One isn't safe to share between searches running at once, so
// each search takes its own from these
var collators = sync.Pool{New: func() any { return collate.New(language.Und) }}

// Rank is the candidates that match a search, best first
func Rank(candidates []*Candidate, query string) []*Candidate {
	matches := Match(candidates, query)
	Sort(matches)
	return matches
}

// Match is the candidates that match a search, scored but in no order. Short searches like "ff" would match nearly
// anything by typo, so only searches of more than 3 letters fall back to it, and only when no name has every word typed
func Match(candidates []*Candidate, query string) []*Candidate {
	var matches []*Candidate
	if preparedQuery := prepareText(query); preparedQuery != nil {
		for _, candidate := range candidates {
			candidate.score = float64(score(candidate.Game, preparedQuery))
			if candidate.score > 0 {
				matches = append(matches, candidate)
			}
		}
	}
	if len(matches) == 0 && length(strings.ReplaceAll(query, " ", "")) > 3 {
		matches = fuzzy(candidates, query)
	}
	return matches
}

// Sort puts matches in order once their popularity is known: best match first; among equals, favorites, then games more
// people have rated (so the well-known games come before hacks and demos with similar names), then the shortest name
// (the game itself before its spin-offs), then alphabetical, which keeps a game's regional versions together
func Sort(matches []*Candidate) {
	// Each name's sort key is made once, rather than at every comparison
	collator := collators.Get().(*collate.Collator)
	defer collators.Put(collator)
	var buffer collate.Buffer
	sortKeys := make(map[*Candidate][]byte, len(matches))
	for _, match := range matches {
		sortKeys[match] = collator.KeyFromString(&buffer, match.FileName)
	}
	titleLengths := make(map[*Candidate]int, len(matches))
	for _, match := range matches {
		titleLengths[match] = length(match.Title)
	}
	sort.SliceStable(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.IsFavorite != b.IsFavorite {
			return a.IsFavorite
		}
		if a.Popularity != b.Popularity {
			return a.Popularity > b.Popularity
		}
		if la, lb := titleLengths[a], titleLengths[b]; la != lb {
			return la < lb
		}
		return bytes.Compare(sortKeys[a], sortKeys[b]) < 0
	})
}
