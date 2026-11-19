// Package config reads the RETROASSEMBLY_RUN_TIME_* settings, as src/constants/env.ts does.
package config

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

// Directories are where each kind of stored file is kept. A kind with no folder of its own set is kept where it always
// was: in the storage folder, or the cache in the data folder
type Directories struct {
	Artwork     string
	Attachments string
	Bioses      string
	Cache       string
	Data        string
	GameSaves   string
	Roms        string
	States      string
	Storage     string
}

// DirectorySettings are the settings that give a kind of file a folder of its own
var DirectorySettings = map[string]string{
	"RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY":    "artwork",
	"RETROASSEMBLY_RUN_TIME_BIOSES_DIRECTORY":     "bioses",
	"RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY":      "cache",
	"RETROASSEMBLY_RUN_TIME_GAME_SAVES_DIRECTORY": "game saves",
	"RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY":       "roms",
	"RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY":     "states",
}

type OIDC struct {
	ClientID     string
	ClientSecret string
	Issuer       string
}

type Config struct {
	// The built browser app, dist/client
	ClientRoot  string
	Directories Directories
	// The SQL migrations Drizzle writes, src/databases/migrations
	MigrationsDirectory string
	OIDC                OIDC
	Port                int
	// When set, stored files are sent from there instead of from disk
	StorageHost string
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func absolute(parts ...string) string {
	result, err := filepath.Abs(filepath.Join(parts...))
	if err != nil {
		return filepath.Join(parts...)
	}
	return result
}

// Load reads the settings. Paths that aren't set are resolved against the current folder, as Node's path.resolve does
func Load() Config {
	dataDirectory := env("RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY", absolute("data"))
	// Not inside the data folder when only that is set: Node resolves the two separately
	storageDirectory := env("RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY", absolute("data", "storage"))
	artwork := os.Getenv("RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY")
	attachments := filepath.Join(storageDirectory, "attachments")
	if artwork != "" {
		attachments = filepath.Join(artwork, "attachments")
	}

	port := 8000
	if value := env("RETROASSEMBLY_RUN_TIME_PORT", os.Getenv("PORT")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed != 0 {
			port = parsed
		}
	}

	return Config{
		ClientRoot: env("RETROASSEMBLY_GO_CLIENT_ROOT", absolute("dist", "client")),
		Directories: Directories{
			Artwork:     artwork,
			Attachments: attachments,
			Bioses:      env("RETROASSEMBLY_RUN_TIME_BIOSES_DIRECTORY", filepath.Join(storageDirectory, "bioses")),
			Cache:       env("RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY", filepath.Join(dataDirectory, "cache")),
			Data:        dataDirectory,
			GameSaves:   env("RETROASSEMBLY_RUN_TIME_GAME_SAVES_DIRECTORY", filepath.Join(storageDirectory, "game-saves")),
			Roms:        env("RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY", filepath.Join(storageDirectory, "roms")),
			States:      env("RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY", filepath.Join(storageDirectory, "states")),
			Storage:     storageDirectory,
		},
		MigrationsDirectory: env("RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY", absolute("src", "databases", "migrations")),
		OIDC: OIDC{
			ClientID:     os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_ID"),
			ClientSecret: os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_SECRET"),
			Issuer:       os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_ISSUER"),
		},
		Port:        port,
		StorageHost: os.Getenv("RETROASSEMBLY_RUN_TIME_STORAGE_HOST"),
	}
}

// DatabasePath is the library's database file
func (c Config) DatabasePath() string {
	return filepath.Join(c.Directories.Data, "retroassembly.sqlite")
}

// AuthMode is "oidc" when OIDC is set up, "local" (passwords) otherwise. Setting only part of OIDC is an error
func (c Config) AuthMode() (string, error) {
	values := []string{c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret}
	set := 0
	for _, value := range values {
		if value != "" {
			set++
		}
	}
	switch set {
	case 0:
		return "local", nil
	case len(values):
		return "oidc", nil
	default:
		return "", errors.New("OIDC issuer, client ID, and client secret must all be set")
	}
}

// resolve is Node's path.resolve(root, id): an absolute id is taken as it is
func resolve(root, id string) string {
	if filepath.IsAbs(id) {
		return filepath.Clean(id)
	}
	return filepath.Join(root, id)
}

// StoragePath is the path on disk of a stored file under directory, or false if its id would reach outside it. Ids
// come from request URLs, where "..%2F" arrives as "../", so an id like "../retroassembly.sqlite" must not be read
func StoragePath(directory, id string) (string, bool) {
	root, err := filepath.Abs(directory)
	if err != nil {
		return "", false
	}
	filePath := resolve(root, id)
	relative, err := filepath.Rel(root, filePath)
	// As in Node, any relative path starting with "..", which also refuses a file named like "..x" at the top
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		return "", false
	}
	return filePath, true
}

// FilePath is the path on disk of a stored file: in its kind's folder ("roms/nes/<id>.nes" is "nes/<id>.nes" in the
// games folder), or in the storage folder for anything else. Ids stay as they are wherever the folders are
func (c Config) FilePath(id string) (string, bool) {
	// Node's path.posix.normalize, which keeps a trailing slash
	normalized := path.Clean(id)
	if strings.HasSuffix(id, "/") && normalized != "/" {
		normalized += "/"
	}
	kind, rest, found := strings.Cut(normalized, "/")
	kindDirectories := map[string]string{
		"attachments": c.Directories.Attachments,
		"bioses":      c.Directories.Bioses,
		"game-saves":  c.Directories.GameSaves,
		"roms":        c.Directories.Roms,
		"states":      c.Directories.States,
	}
	// "roms/" with nothing after it is refused, not looked for in the storage folder
	if directory, ok := kindDirectories[kind]; ok && found {
		return StoragePath(directory, rest)
	}
	return StoragePath(c.Directories.Storage, id)
}
