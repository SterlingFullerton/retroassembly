package library

import (
	"encoding/json"
	"path"
	"regexp"
	"strings"
)

// The cleaning goodcodes-parser does to a file name, keeping only the game's name
var (
	bracketTags     = regexp.MustCompile(`\[.*]`)
	roundTags       = regexp.MustCompile(`\(.*\)`)
	numberPrefix    = regexp.MustCompile(`^\s*[0-9]+\s*-\s*`)
	spacedExtension = regexp.MustCompile(`\s+(\.[a-z0-9]+)$`)
	extensionAtEnd  = regexp.MustCompile(`\.[a-z0-9]+$`)
)

// nameWithoutExtension is Node's path.parse(fileName).name: the file name without its last extension, if it has one
// after its first character
func nameWithoutExtension(fileName string) string {
	base := path.Base(fileName)
	if fileName == "" {
		return ""
	}
	if dot := strings.LastIndex(base, "."); dot > 0 {
		return base[:dot]
	}
	return base
}

// moveArticleToFront puts an article that file names put last first: "Legend of Zelda, The - Link's Awakening" is
// "The Legend of Zelda - Link's Awakening"
func moveArticleToFront(name string) string {
	for i := 1; i < len(name); i++ {
		if !strings.HasPrefix(name[i:], ", ") {
			continue
		}
		rest := name[i+2:]
		for _, article := range []string{"The", "A", "An"} {
			after, found := strings.CutPrefix(rest, article)
			if found && (after == "" || strings.HasPrefix(after, " - ")) {
				return article + " " + name[:i] + after
			}
		}
	}
	return name
}

// RomTitle is the name a game is shown under, as getRomGoodcodes(rom).rom gives it: the name the player gave it, or
// its file name without tags and extension, or for an arcade game, its name in libretro's database
func RomTitle(rom Object) string {
	fileName, _ := rom.Get("fileName").(string)
	name := nameWithoutExtension(fileName)
	if rom.Get("platform") == "arcade" {
		if raw, ok := rom.Get("rawGameMetadata").(json.RawMessage); ok {
			var metadata struct {
				Libretro *struct {
					Name string `json:"name"`
				} `json:"libretro"`
			}
			if json.Unmarshal(raw, &metadata) == nil && metadata.Libretro != nil && metadata.Libretro.Name != "" {
				name = metadata.Libretro.Name
			}
		}
	}
	cleaned := "0 - " + name
	cleaned = bracketTags.ReplaceAllString(cleaned, "")
	cleaned = roundTags.ReplaceAllString(cleaned, "")
	cleaned = numberPrefix.ReplaceAllString(cleaned, "")
	cleaned = spacedExtension.ReplaceAllString(cleaned, "$1")
	title := moveArticleToFront(extensionAtEnd.ReplaceAllString(strings.TrimSpace(cleaned), ""))
	if gameTitle, ok := rom.Get("gameTitle").(string); ok && strings.TrimSpace(gameTitle) != "" {
		return strings.TrimSpace(gameTitle)
	}
	return title
}
