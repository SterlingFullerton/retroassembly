// Package config reads the RETROASSEMBLY_RUN_TIME_* settings, as src/constants/env.ts does.
package config

import (
	"errors"
	"math"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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
	// A file of certificate authorities trusted for the provider besides the system's (NODE_EXTRA_CA_CERTS, which the
	// Node server trusts them from)
	ExtraCertificates string
	Issuer            string
	// Where the provider sends the browser back to. Unset, it's /login/oidc/callback on the address the app was reached at
	RedirectURI string
	// A role the identity must have to sign in, from its roles claim. Unset, any identity may
	RequiredRole string
	Scopes       string
	// How long a session started with OIDC lasts
	SessionMaxAge time.Duration
}

// sessionMaxAge reads milliseconds as the Node server does, Math.trunc(Number(value)), with 8 hours for anything that
// isn't above zero
func sessionMaxAge(value string) time.Duration {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.Trunc(parsed) <= 0 {
		return 8 * time.Hour
	}
	if math.IsInf(parsed, 1) || parsed > float64(math.MaxInt64/int64(time.Millisecond)) {
		return time.Duration(math.MaxInt64)
	}
	return time.Duration(math.Trunc(parsed)) * time.Millisecond
}

type Config struct {
	// Whether the server keeps its own copies of CDN files (RETROASSEMBLY_RUN_TIME_CDN_CACHE)
	CDNCache bool
	// The built browser app, dist/client
	ClientRoot  string
	Directories Directories
	// How many automatic save states are kept for each game
	MaxAutoStatesPerRom int
	// The SQL migrations Drizzle writes, src/databases/migrations
	MigrationsDirectory string
	// The Node server, which answers what the Go server doesn't yet. Unset, those requests are answered with 501
	NodeURL string
	OIDC    OIDC
	Port    int
	// When set, stored files are sent from there instead of from disk
	StorageHost string
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// setOr is the setting, even when it's set to nothing, or fallback when it isn't set at all, as es-toolkit's defaults
// fills in the Node server's
func setOr(name, fallback string) string {
	if value, set := os.LookupEnv(name); set {
		return value
	}
	return fallback
}

// positiveInteger reads a number as the Node server does, Math.trunc(Number(value)) || fallback: its whole part, or
// fallback for nothing, zero or anything that isn't a number. Below 1, where the Node server would misbehave, is the
// fallback too
func positiveInteger(value string, fallback int) int {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || int(parsed) < 1 {
		return fallback
	}
	return int(parsed)
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
		CDNCache:   os.Getenv("RETROASSEMBLY_RUN_TIME_CDN_CACHE") == "true",
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
		MaxAutoStatesPerRom: positiveInteger(os.Getenv("RETROASSEMBLY_RUN_TIME_MAX_AUTO_STATES_PER_ROM"), 20),
		MigrationsDirectory: env("RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY", absolute("src", "databases", "migrations")),
		NodeURL:             os.Getenv("RETROASSEMBLY_GO_NODE_URL"),
		OIDC: OIDC{
			ClientID:          os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_ID"),
			ClientSecret:      os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_SECRET"),
			ExtraCertificates: os.Getenv("NODE_EXTRA_CA_CERTS"),
			Issuer:            os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_ISSUER"),
			RedirectURI:       os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_REDIRECT_URI"),
			RequiredRole:      strings.TrimSpace(os.Getenv("RETROASSEMBLY_RUN_TIME_OIDC_REQUIRED_ROLE")),
			Scopes:            setOr("RETROASSEMBLY_RUN_TIME_OIDC_SCOPES", "openid profile email"),
			SessionMaxAge:     sessionMaxAge(env("RETROASSEMBLY_RUN_TIME_OIDC_SESSION_MAX_AGE", "28800000")),
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
