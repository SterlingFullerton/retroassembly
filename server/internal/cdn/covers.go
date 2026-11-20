package cdn

import (
	"encoding/json"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
)

// libretro adds covers now and then, so its lists are fetched again once they're a week old
const coverListMaxAge = 7 * 24 * time.Hour

// Rom is what a game's pictures are found from
type Rom struct {
	FileName string
	Platform string
	Metadata Metadata
}

// Metadata is the part of a game's info its pictures are found from
type Metadata struct {
	Launchbox *struct {
		Name *string `json:"name"`
	} `json:"launchbox"`
	Libretro *struct {
		Name     *string `json:"name"`
		Platform *string `json:"platform"`
	} `json:"libretro"`
}

// ParseMetadata reads a game's raw_game_metadata. Anything that isn't what's expected counts as nothing
func ParseMetadata(raw []byte) Metadata {
	var metadata Metadata
	if len(raw) > 0 && json.Unmarshal(raw, &metadata) != nil {
		return Metadata{}
	}
	return metadata
}

func text(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (m Metadata) libretroName() string {
	if m.Libretro == nil {
		return ""
	}
	return text(m.Libretro.Name)
}

func (m Metadata) libretroPlatform() string {
	if m.Libretro == nil {
		return ""
	}
	return text(m.Libretro.Platform)
}

func (m Metadata) launchboxName() string {
	if m.Launchbox == nil {
		return ""
	}
	return text(m.Launchbox.Name)
}

// nameWithoutExtension is a game's file name without its extension, keeping any full stops in the name: "Dr. Mario
// (World).gb" is "Dr. Mario (World)"
func nameWithoutExtension(fileName string) string {
	if dot := strings.LastIndex(fileName, "."); dot > 0 {
		return fileName[:dot]
	}
	return fileName
}

// LibretroFolder is the folder libretro keeps a console's art in, such as "Nintendo - Game Boy"; all arcade games are
// in "MAME"
func (d *Data) LibretroFolder(platform string) string {
	name := d.LibretroNames[platform]
	if name == "" {
		name = platform
	}
	if strings.Contains(name, "MAME") {
		return "MAME"
	}
	return name
}

// fileNameOf is the name libretro files a game's picture under: the characters a file name can't hold are "_"
func fileNameOf(name string) string {
	var builder strings.Builder
	for i := 0; i < len(name); i++ {
		switch {
		case strings.IndexByte("&*/:`<>?\\", name[i]) >= 0:
			builder.WriteByte('_')
		case name[i] == '|' && i+1 < len(name) && name[i+1] == '"':
			builder.WriteByte('_')
			i++
		default:
			builder.WriteByte(name[i])
		}
	}
	return builder.String()
}

var thumbnailFolders = map[string]string{
	"boxart": "Named_Boxarts", "logo": "Named_Logos", "snap": "Named_Snaps", "title": "Named_Titles",
}

// Thumbnail is the address under /cdn/ of one of libretro's pictures of a game: "boxart", "title", "snap" or "logo"
func (d *Data) Thumbnail(name, platform, kind string) string {
	if name == "" || platform == "" {
		return ""
	}
	folder := d.LibretroFolder(platform)
	if folder == "" {
		return ""
	}
	href, ok := resolve(LibretroHost, folder+"/"+thumbnailFolders[kind]+"/"+fileNameOf(name)+".png")
	if !ok {
		return ""
	}
	return ToCacheURL(href)
}

// romThumbnail is a picture of a game by its name in libretro's database
func (d *Data) romThumbnail(rom Rom, kind string) string {
	name := rom.Metadata.libretroName()
	if name == "" || rom.Platform == "" {
		return ""
	}
	platform := rom.Metadata.libretroPlatform()
	if platform == "" {
		platform = d.LibretroNames[rom.Platform]
	}
	if platform == "" {
		platform = rom.Platform
	}
	return d.Thumbnail(name, platform, kind)
}

// Candidates are the libretro pictures that may show a game, best first, as getRomCoverCandidates gives them with the
// cache on: box art, title screen, then screenshot, by its name in libretro's database, then by its file name. An
// empty one is a picture there's no name for
func (d *Data) Candidates(rom Rom) []string {
	kinds := []string{"boxart", "title", "snap"}
	var candidates []string
	for _, kind := range kinds {
		candidates = append(candidates, d.romThumbnail(rom, kind))
	}
	name := nameWithoutExtension(rom.FileName)
	for _, kind := range kinds {
		candidates = append(candidates, d.Thumbnail(name, rom.Platform, kind))
	}
	return candidates
}

// JavaScript's \s, and what its trim() removes
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func jsTrim(value string) string {
	return strings.TrimFunc(value, func(r rune) bool {
		return strings.ContainsRune("\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff", r) || r >= 0x2000 && r <= 0x200a
	})
}

var (
	pngExtension = regexp.MustCompile(`(?i)\.png$`)
	tags         = regexp.MustCompile(`[` + jsSpace + `]*[(\[][^)\]]*[)\]]`)
	lastArticle  = regexp.MustCompile(`^(.*?), (The|A|An)( - .*)?$`)
	notAlnum     = regexp.MustCompile(`[^a-z\d]`)
	roundTag     = regexp.MustCompile(`\(([^)]*)\)`)
	regionSplit  = regexp.MustCompile(`,[` + jsSpace + `]*|-`)
	lesserCopy   = regexp.MustCompile(`(?i)\[(?:b|h|p|a|f|t|o)[^\]]*\]|\((?:hack|beta|proto|demo|pirate|sample)[^)]*\)`)
)

// TitleKey is what a name says about the game alone: no region, language or dump tags, "The" moved to the front, and
// only letters and digits. "Legend of Zelda, The - Link's Awakening (USA) [!]" and "The Legend of Zelda: Link's
// Awakening (Europe)" are both "thelegendofzeldalinksawakening"
func TitleKey(name string) string {
	title := tags.ReplaceAllString(pngExtension.ReplaceAllString(name, ""), "")
	if match := lastArticle.FindStringSubmatch(title); match != nil {
		title = match[2] + " " + match[1] + match[3]
	}
	title = strings.ReplaceAll(strings.ToLower(title), "&", "and")
	return notAlnum.ReplaceAllString(title, "")
}

// Region tags in No-Intro ("USA, Europe"), TOSEC ("EU-US") and GoodTools ("U", "JU") names
var regionAliases = map[string][]string{
	"as": {"asia"}, "asia": {"asia"}, "au": {"australia"}, "australia": {"australia"}, "b": {"brazil"},
	"br": {"brazil"}, "brazil": {"brazil"}, "de": {"germany"}, "e": {"europe"}, "eu": {"europe"},
	"europe": {"europe"}, "f": {"france"}, "fr": {"france"}, "france": {"france"}, "g": {"germany"},
	"germany": {"germany"}, "j": {"japan"}, "japan": {"japan"}, "jp": {"japan"}, "ju": {"japan", "usa"},
	"k": {"korea"}, "korea": {"korea"}, "kr": {"korea"}, "u": {"usa"}, "ue": {"usa", "europe"}, "us": {"usa"},
	"usa": {"usa"}, "w": {"world"}, "world": {"world"},
}

// Regions are the regions a name's tags say, in the order they first appear
func Regions(name string) []string {
	var regions []string
	seen := map[string]bool{}
	for _, match := range roundTag.FindAllStringSubmatch(name, -1) {
		for _, part := range regionSplit.Split(match[1], -1) {
			for _, region := range regionAliases[strings.ToLower(jsTrim(part))] {
				if !seen[region] {
					seen[region] = true
					regions = append(regions, region)
				}
			}
		}
	}
	return regions
}

var regionPreference = []string{"usa", "world", "europe", "japan"}

// scoreCover is how well one of libretro's covers suits a game: its own region first, then a clean copy, then a common
// region
func scoreCover(cover string, gameRegions map[string]bool) float64 {
	regions := Regions(cover)
	score := 0.0
	for _, region := range regions {
		if gameRegions[region] {
			score = 1000
			break
		}
	}
	score -= float64(len(lesserCopy.FindAllString(cover, -1))) * 100
	preferred := len(regionPreference) + 1
	for _, region := range regions {
		index := len(regionPreference)
		for i, each := range regionPreference {
			if each == region {
				index = i
			}
		}
		preferred = min(preferred, index)
	}
	score -= float64(preferred) * 10
	// By the name's length as JavaScript counts it
	return score - float64(len(utf16.Encode([]rune(cover))))/1000
}

type coverList struct {
	byTitle map[string][]string
	time    float64
}

// CoverListURL is the page listing a console's box art on libretro's thumbnail server
func CoverListURL(folder string) string {
	href, _ := resolve(LibretroHost, EncodeURIComponent(folder)+"/Named_Boxarts/")
	return href
}

var coverLink = regexp.MustCompile(`<a href="([^"?/][^"]*\.png)"`)

// coverList is libretro's box art for a console, by title, from the copy kept with the cache
func (c *Cache) coverList(folder string, offline bool) (*coverList, error) {
	cached, err := c.File(CoverListURL(folder), coverListMaxAge, offline)
	if err != nil || cached == nil || cached.Status != 200 {
		return nil, nil
	}
	c.mutex.Lock()
	known := c.coverLists[folder]
	c.mutex.Unlock()
	if known != nil && known.time == cached.Time {
		return known, nil
	}
	// Read once however many games ask for it at the same time: the list is a few MB of HTML
	if _, err := c.once(c.coverParses, folder, func() (string, error) { return "", c.parseCoverList(folder, cached) }); err != nil {
		return nil, err
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.coverLists[folder], nil
}

func (c *Cache) parseCoverList(folder string, cached *Entry) error {
	c.mutex.Lock()
	known := c.coverLists[folder]
	c.mutex.Unlock()
	if known != nil && known.time == cached.Time {
		return nil
	}
	html, err := os.ReadFile(cached.Path)
	if err != nil {
		return err
	}
	list := &coverList{byTitle: map[string][]string{}, time: cached.Time}
	for _, match := range coverLink.FindAllStringSubmatch(string(html), -1) {
		name, err := DecodeURIComponent(match[1])
		if err != nil {
			return err
		}
		name = pngExtension.ReplaceAllString(name, "")
		key := TitleKey(name)
		list.byTitle[key] = append(list.byTitle[key], name)
	}
	c.mutex.Lock()
	c.coverLists[folder] = list
	c.mutex.Unlock()
	return nil
}

// RefreshCoverList fetches libretro's list of covers for a console, so matching works offline. Run by the prefetch
func (c *Cache) RefreshCoverList(folder string) (bool, error) {
	list, err := c.coverList(folder, false)
	return list != nil, err
}

// MatchedCover is the address of libretro's box art for a game whose own names find none, matched by title: its name
// in libretro's database, its file name, then its LaunchBox name. Empty when libretro has no box art with that title
func (c *Cache) MatchedCover(rom Rom, offline bool) (string, error) {
	platform := rom.Metadata.libretroPlatform()
	if platform == "" {
		platform = rom.Platform
	}
	folder := c.LibretroFolder(platform)
	if folder == "" {
		return "", nil
	}
	list, err := c.coverList(folder, offline)
	if err != nil || list == nil {
		return "", err
	}
	var names []string
	for _, name := range []string{rom.Metadata.libretroName(), nameWithoutExtension(rom.FileName), rom.Metadata.launchboxName()} {
		if name != "" {
			names = append(names, name)
		}
	}
	gameRegions := map[string]bool{}
	for _, name := range names {
		for _, region := range Regions(name) {
			gameRegions[region] = true
		}
	}
	for _, name := range names {
		covers := list.byTitle[TitleKey(name)]
		if len(covers) == 0 {
			continue
		}
		sorted := append([]string(nil), covers...)
		sort.SliceStable(sorted, func(i, j int) bool {
			return scoreCover(sorted[i], gameRegions) > scoreCover(sorted[j], gameRegions)
		})
		return c.Thumbnail(sorted[0], folder, "boxart"), nil
	}
	return "", nil
}

func isBoxArt(href string) bool {
	return strings.Contains(href, "/Named_Boxarts/")
}

// statusOf tells whether the cache has a picture (200), knows it doesn't exist (404), or has yet to look for it (0)
func (c *Cache) statusOf(href string) (int, error) {
	cachePath, found := strings.CutPrefix(href, "/cdn/")
	if !found {
		return 0, nil
	}
	target, err := c.ResolveTarget(cachePath)
	if err != nil || target == nil {
		return 0, err
	}
	return c.Status(target.URL, c.Offline)
}

// CoverCandidates are the pictures of a game the server has, as addCoverCandidates notes them, so pages don't ask for
// ones that don't exist: box art first, under the game's own names, then libretro's box art matched by title, and only
// then a title screen or screenshot. The first the server has is the one shown, so the rest are left out; one it
// hasn't looked for yet may still exist, unless it's offline
func (c *Cache) CoverCandidates(rom Rom) ([]string, error) {
	var all []string
	seen := map[string]bool{}
	for _, candidate := range c.Candidates(rom) {
		if candidate != "" && !seen[candidate] {
			seen[candidate] = true
			all = append(all, candidate)
		}
	}
	candidates := []string{}
	found := func(href string) (bool, error) {
		status, err := c.statusOf(href)
		if err != nil {
			return false, err
		}
		if status == 200 || status == 0 && !c.Offline {
			candidates = append(candidates, href)
		}
		return status == 200, nil
	}
	for _, href := range all {
		if !isBoxArt(href) {
			continue
		}
		if ok, err := found(href); err != nil || ok {
			return candidates, err
		}
	}
	matched, err := c.MatchedCover(rom, c.Offline)
	if err != nil {
		return nil, err
	}
	if matched != "" && !seen[matched] {
		if ok, err := found(matched); err != nil || ok {
			return candidates, err
		}
	}
	for _, href := range all {
		if isBoxArt(href) {
			continue
		}
		if ok, err := found(href); err != nil || ok {
			return candidates, err
		}
	}
	return candidates, nil
}
