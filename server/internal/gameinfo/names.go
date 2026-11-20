// Package gameinfo finds a game's info (name, year, developer, players, genres, description) in the game info database
// built with the app from LaunchBox's and libretro's own databases (scripts/game-info.ts), as
// src/utils/server/game-info does. The matching is msleuth's, by arianrhodsandlot (MIT).
package gameinfo

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// JavaScript's \s, and what its trim() removes
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func isJSSpace(r rune) bool {
	return strings.ContainsRune("\t\n\v\f\r       　", r) || r == 0xfeff ||
		r >= 0x2000 && r <= 0x200a
}

// Trim is JavaScript's String.prototype.trim
func Trim(value string) string {
	return jsTrim(value)
}

func jsTrim(value string) string {
	return strings.TrimFunc(value, isJSSpace)
}

// jsLower is JavaScript's toLowerCase: as Go's, but for the capital I with a dot, which becomes an i and a combining
// dot, and a capital sigma ending a word, which becomes a final sigma
func jsLower(value string) string {
	runes := []rune(value)
	var builder strings.Builder
	for i, r := range runes {
		switch {
		case r == 'İ':
			builder.WriteString("i̇")
		case r == 'Σ' && i > 0 && unicode.IsLetter(runes[i-1]) && (i+1 == len(runes) || !unicode.IsLetter(runes[i+1])):
			builder.WriteRune('ς')
		default:
			builder.WriteRune(unicode.ToLower(r))
		}
	}
	return builder.String()
}

// CompactName is a name with letters and digits only, lowercase: "Super Mario Bros. 3" is "supermariobros3"
func CompactName(name string) string {
	var builder strings.Builder
	for _, r := range name {
		if unicode.In(r, unicode.Letter, unicode.Mark, unicode.Number) {
			builder.WriteRune(r)
		}
	}
	return jsLower(builder.String())
}

// The cleaning goodcodes-parser does to a file name
var (
	bracketTags     = regexp.MustCompile(`\[.*]`)
	roundTags       = regexp.MustCompile(`\(.*\)`)
	numberPrefix    = regexp.MustCompile(`^[` + jsSpace + `]*[0-9]+[` + jsSpace + `]*-[` + jsSpace + `]*`)
	spacedExtension = regexp.MustCompile(`[` + jsSpace + `]+(\.[a-z0-9]+)$`)
	extensionAtEnd  = regexp.MustCompile(`\.[a-z0-9]+$`)
)

// GoodcodesBase is a name without its GoodTools tags: "Tetris (World) [!]" is "Tetris"
func GoodcodesBase(name string) string {
	cleaned := "0 - " + name
	cleaned = bracketTags.ReplaceAllString(cleaned, "")
	cleaned = roundTags.ReplaceAllString(cleaned, "")
	cleaned = numberPrefix.ReplaceAllString(cleaned, "")
	cleaned = spacedExtension.ReplaceAllString(cleaned, "$1")
	return extensionAtEnd.ReplaceAllString(jsTrim(cleaned), "")
}

// GoodcodesBaseCompactName is a name without its GoodTools tags, compacted: "Tetris (World) [!]" is "tetris"
func GoodcodesBaseCompactName(name string) string {
	return CompactName(GoodcodesBase(name))
}

var articleLast = regexp.MustCompile(`^(.*),[` + jsSpace + `]*(A|An|The)([` + jsSpace + `]*(?:[^` + jsSpace + `].*)?)$`)

// RestoreTitleForSorting puts an article back in front: "Legend of Zelda, The (USA)" is "The Legend of Zelda (USA)"
func RestoreTitleForSorting(title string) string {
	if match := articleLast.FindStringSubmatch(title); match != nil {
		return match[2] + " " + match[1] + match[3]
	}
	return title
}

type country struct{ code, name string }

// goodcodes-parser's countries, in its order
var countries = []country{
	{"1", "Japan & Korea"}, {"4", "USA & Brazil"}, {"A", "Australia"}, {"As", "Asia"}, {"B", "Brazil"}, {"Ch", "China"},
	{"C", "Canada"}, {"D", "Netherlands"}, {"E", "Europe"}, {"F", "France"}, {"Fn", "Finland"}, {"G", "Germany"},
	{"Gr", "Greece"}, {"HK", "Hong Kong"}, {"I", "Italy"}, {"J", "Japan"}, {"K", "Korea"}, {"Nl", "Netherlands"},
	{"No", "Norway"}, {"R", "Russia"}, {"S", "Spain"}, {"Sw", "Sweden"}, {"U", "USA"}, {"UK", "United Kingdom"},
	{"Tw", "Taiwan"}, {"W", "World"}, {"Unl", "Unlicensed"}, {"PD", "Public domain"}, {"Unk", "Unknown"},
}

var (
	// Names of more than one word, whose first space becomes a "-" so a list of names can be split on spaces
	multiWordCountries = regexp.MustCompile(`japan & korea|usa & brazil|hong kong|united kingdom|public domain`)
	firstSpaces        = regexp.MustCompile(`[` + jsSpace + `]+`)
	countryByKey       = map[string]country{}
	// The countries' codes, longest first, for reading codes run together, as "UE"
	countryCodes  []string
	listSeparator = regexp.MustCompile(`[,` + jsSpace + `]+`)
)

func standardizeCountries(value string) string {
	return multiWordCountries.ReplaceAllStringFunc(jsLower(value), func(name string) string {
		location := firstSpaces.FindStringIndex(name)
		return name[:location[0]] + "-" + name[location[1]:]
	})
}

func init() {
	for _, each := range countries {
		countryByKey[strings.ToLower(each.code)] = each
		countryByKey[standardizeCountries(each.name)] = each
		countryCodes = append(countryCodes, strings.ToLower(each.code))
	}
	sort.SliceStable(countryCodes, func(i, j int) bool { return len(countryCodes[i]) > len(countryCodes[j]) })
}

func countriesFromNames(tag string) []country {
	var list []country
	for _, part := range listSeparator.Split(tag, -1) {
		if each, found := countryByKey[jsTrim(part)]; found {
			list = append(list, each)
		}
	}
	return list
}

func countriesFromCodes(tag string) []country {
	for _, code := range countryCodes {
		rest, found := strings.CutPrefix(tag, code)
		if !found {
			continue
		}
		if rest == "" {
			return []country{countryByKey[code]}
		}
		if more := countriesFromCodes(rest); more != nil {
			return append([]country{countryByKey[code]}, more...)
		}
		return nil
	}
	return nil
}

var (
	codePattern = regexp.MustCompile(`((?:\[[^\]]+])|(?:\([^)]+\)))`)
	// The tags goodcodes-parser reads as something else before it tries them as countries
	notCountries = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^\(.*Hack\)$`),
		regexp.MustCompile(`(?i)^\[a(\d*)(?:(\+)?(\d+)?C)?]|\(alt\s*(\d+)\)$`),
		regexp.MustCompile(`(?i)^\((?:REV|PRG)\s*(?:(\d+)|([a-z]))\)$`),
		regexp.MustCompile(`^\(V(\d+)(?:\.(\d+)(?:\.(\d+))?)?\)$`),
		regexp.MustCompile(`(?i)^\((Alpha|Beta|Pre-Release|Prototype|Proto|Demo|Sample|old)(?:\s*(?:(\d+)(?:\.(\d+)(?:\.(\d+))?)?)|(.*))?\)$`),
		regexp.MustCompile(`^\(M(\d+)\)$`),
		regexp.MustCompile(`^\((PAL|NTSC)\)$`),
		regexp.MustCompile(`^\(Compilation\)$`),
	}
	countryTag = regexp.MustCompile(`(?i)^\(([a-z14, ]+)\)$`)
	discTag    = regexp.MustCompile(`(?i)\(Disc \d+\)`)
)

// Countries are the countries a GoodTools or No-Intro name says it's for, by name, as goodcodes-parser reads them: "Tetris
// (UE)" is USA and Europe. "(Disc 4)" is left out, as GoodTools would read its 4 as a country code
func Countries(name string) []string {
	file := "0 - " + discTag.ReplaceAllString(name, "") + ".x"
	var found []country
codes:
	for _, code := range codePattern.FindAllString(file, -1) {
		for _, other := range notCountries {
			if other.MatchString(code) {
				continue codes
			}
		}
		match := countryTag.FindStringSubmatch(code)
		if match == nil {
			continue
		}
		tag := standardizeCountries(match[1])
		list := countriesFromNames(tag)
		if list == nil {
			list = countriesFromCodes(tag)
		}
		if list != nil {
			found = list
		}
	}
	names := []string{}
	for _, each := range found {
		names = append(names, strings.Split(each.name, " & ")...)
	}
	return names
}

var (
	bracketed    = regexp.MustCompile(`\[[^\]]*\]`)
	revisionWord = regexp.MustCompile(`(?i)[` + jsSpace + `]+Rev[` + jsSpace + `]+[^` + jsSpace + `(,]+`)
	revisionTag  = regexp.MustCompile(`(?i)[` + jsSpace + `]+\((?:Rev|PRG)[^)]*\)`)
	spaces       = regexp.MustCompile(`[` + jsSpace + `]+`)
)

// NameForLaunchbox is a name without its revision and dump tags: "Castlevania Rev PRG1 (USA)" and "Castlevania (U)
// (PRG1) [!]" both become names LaunchBox knows. Region and other tags in brackets are left, as the lookup reads them
func NameForLaunchbox(name string) string {
	name = bracketed.ReplaceAllString(name, "")
	name = revisionWord.ReplaceAllString(name, "")
	name = revisionTag.ReplaceAllString(name, "")
	return jsTrim(spaces.ReplaceAllString(name, " "))
}

// ParsePath is Node's path.parse(fileName) name and extension: the extension is from the last "." of the file's own
// name, unless that's its first character
func ParsePath(fileName string) (name, extension string) {
	base := fileName
	if slash := strings.LastIndex(base, "/"); slash >= 0 {
		base = base[slash+1:]
	}
	if dot := strings.LastIndex(base, "."); dot > 0 {
		return base[:dot], base[dot:]
	}
	return base, ""
}
