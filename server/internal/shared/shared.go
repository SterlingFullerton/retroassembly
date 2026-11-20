// Package shared is what the Go server knows from the app's TypeScript definitions, written by
// scripts/go-shared-data.ts.
package shared

import (
	_ "embed"
	"encoding/json"
)

//go:embed shared.json
var content []byte

// Language is one of the app's languages, with the messages the server writes in it
type Language struct {
	Code     string            `json:"code"`
	Messages map[string]string `json:"messages"`
}

// CDN is what the CDN cache needs to know
type CDN struct {
	// The fonts' paths on the CDN, which anyone may have cached
	FontPaths []string `json:"fontPaths"`
	// The folder libretro keeps each console's art in, when it has one
	LibretroNames map[string]string `json:"libretroNames"`
	// The GitHub repositories whose files anyone may have cached, at these versions only
	PinnedRepositories map[string]string `json:"pinnedRepositories"`
	// The files the prefetch downloads for its categories that don't depend on the library
	Prefetch struct {
		Assets  []string `json:"assets"`
		Shaders []string `json:"shaders"`
	} `json:"prefetch"`
}

type Data struct {
	CDN CDN `json:"cdn"`
	// Each language's date format, for reading dates typed in it
	DateFormats     map[string]string `json:"dateFormats"`
	DefaultLanguage string            `json:"defaultLanguage"`
	// The settings a user starts with, before their own
	DefaultPreference json.RawMessage `json:"defaultPreference"`
	// The languages, in the app's order
	Languages []Language `json:"languages"`
	// The consoles whose games come on several discs, which are grouped into one game
	MultiDiscConsoles []string `json:"multiDiscConsoles"`
	// The key of each console's name in the translations
	PlatformNames map[string]string `json:"platformNames"`
	// Every console, in the app's usual order
	Platforms []string `json:"platforms"`
	// The consoles whose game pages are sent with cross-origin isolation headers
	ThreadedConsoles []string `json:"threadedConsoles"`
}

func Load() (Data, error) {
	var data Data
	err := json.Unmarshal(content, &data)
	return data, err
}
