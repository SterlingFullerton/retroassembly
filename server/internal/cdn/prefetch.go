package cdn

import (
	"log"
	"strings"
	"sync"
)

// The prefetch downloads files into the cache when the server starts, so they're there without the internet, as
// src/utils/server/cdn-prefetch.ts does. CDN_PREFETCH is a comma-separated list of cores,
// shaders, assets and thumbnails; all means all but thumbnails, as box art and screenshots for every game in the
// library can take several GB

var (
	prefetchCategories = []string{"cores", "shaders", "assets", "thumbnails"}
	defaultCategories  = map[string]bool{"assets": true, "cores": true, "shaders": true}
)

const prefetchWorkers = 4

// orderedSet keeps addresses in the order they're first added, once each
type orderedSet struct {
	seen  map[string]bool
	items []string
}

func (s *orderedSet) add(item string) {
	if s.seen == nil {
		s.seen = map[string]bool{}
	}
	if !s.seen[item] {
		s.seen[item] = true
		s.items = append(s.items, item)
	}
}

func (c *Cache) toUpstream(href string) string {
	cachePath, found := strings.CutPrefix(href, "/cdn/")
	if !found {
		return href
	}
	target, err := c.ResolveTarget(cachePath)
	if err != nil || target == nil {
		return ""
	}
	return target.URL
}

func (c *Cache) prefetchURLs(selected map[string]bool, roms func() ([]Rom, error)) ([]string, error) {
	var urls orderedSet
	// cores is still accepted, but needs nothing now: every emulator is served by the app itself
	if selected["shaders"] {
		for _, href := range c.Data.Prefetch.Shaders {
			urls.add(href)
		}
	}
	if selected["assets"] {
		for _, href := range c.Data.Prefetch.Assets {
			urls.add(href)
		}
	}
	if selected["thumbnails"] {
		// The same addresses the library and game pages ask for, for every game of every user
		games, err := roms()
		if err != nil {
			return nil, err
		}
		// libretro's list of each console's box art first, so games whose names find none can be matched by title
		var folders orderedSet
		for _, rom := range games {
			platform := rom.Metadata.libretroPlatform()
			if platform == "" {
				platform = rom.Platform
			}
			folders.add(c.LibretroFolder(platform))
		}
		for _, folder := range folders.items {
			if folder != "" {
				c.RefreshCoverList(folder)
			}
		}
		for _, rom := range games {
			if matched, err := c.MatchedCover(rom, false); err == nil && matched != "" {
				urls.add(matched)
			}
			for _, kind := range []string{"boxart", "title", "snap", "logo"} {
				urls.add(c.romThumbnail(rom, kind))
			}
			// The pages also look up art by file name, which is how games without metadata get theirs
			name := nameWithoutExtension(rom.FileName)
			for _, kind := range []string{"boxart", "title", "snap"} {
				urls.add(c.Thumbnail(name, rom.Platform, kind))
			}
		}
	}
	var upstream []string
	for _, href := range urls.items {
		if href = c.toUpstream(href); href != "" {
			upstream = append(upstream, href)
		}
	}
	return upstream, nil
}

// Counts are how a prefetch went
type Counts struct {
	Cached, Failed, Missing int
}

// Prefetch downloads the files of the categories value names into the cache
func (c *Cache) Prefetch(value string, roms func() ([]Rom, error)) (Counts, error) {
	requested := map[string]bool{}
	for _, category := range strings.Split(value, ",") {
		requested[strings.TrimSpace(category)] = true
	}
	selected := map[string]bool{}
	var names []string
	for _, category := range prefetchCategories {
		if requested[category] || requested["all"] && defaultCategories[category] {
			selected[category] = true
			names = append(names, category)
		}
	}
	urls, err := c.prefetchURLs(selected, roms)
	if err != nil {
		return Counts{}, err
	}

	var (
		counts Counts
		mutex  sync.Mutex
		next   int
		group  sync.WaitGroup
	)
	log.Printf("Prefetching %d CDN files (%s)...", len(urls), strings.Join(names, ", "))
	for range prefetchWorkers {
		group.Go(func() {
			for {
				mutex.Lock()
				if next >= len(urls) {
					mutex.Unlock()
					return
				}
				href := urls[next]
				next++
				mutex.Unlock()

				cached, err := c.File(href, 0, false)
				mutex.Lock()
				switch {
				case err != nil:
					counts.Failed++
				case cached != nil && cached.Status == 200:
					counts.Cached++
				default:
					counts.Missing++
				}
				if done := counts.Cached + counts.Missing + counts.Failed; done%1000 == 0 {
					log.Printf("Prefetched %d of %d CDN files...", done, len(urls))
				}
				mutex.Unlock()
			}
		})
	}
	group.Wait()
	log.Printf("Prefetched CDN files: %d cached, %d not found upstream, %d failed", counts.Cached, counts.Missing,
		counts.Failed)
	return counts, nil
}
