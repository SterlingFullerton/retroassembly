// Package shared is what the Go server knows from the app's TypeScript definitions, written by
// scripts/go-shared-data.ts.
package shared

import (
	_ "embed"
	"encoding/json"
)

//go:embed shared.json
var content []byte

type Data struct {
	// The settings a user starts with, before their own
	DefaultPreference json.RawMessage `json:"defaultPreference"`
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
