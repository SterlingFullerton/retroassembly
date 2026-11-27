// Package config reads the settings (ROMS_DIR, CDN_CACHE and the rest; see Names), as src/constants/env.ts does.
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

// NASGames is where the game service on the NAS is, and the key it expects
type NASGames struct {
	Key string
	URL string
}

// DirectorySettings are the settings that give a kind of file a folder of its own
var DirectorySettings = map[string]string{
	"ARTWORK_DIR": "artwork",
	"BIOSES_DIR":  "bioses",
	"CACHE_DIR":   "cache",
	"SAVES_DIR":   "game saves",
	"ROMS_DIR":    "roms",
	"STATES_DIR":  "states",
}

// Names are the settings, each with the longer name it had before, which is still read when the short one isn't set
var Names = map[string]string{
	"ARTWORK_DIR":                 "RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY",
	"BIOSES_DIR":                  "RETROASSEMBLY_RUN_TIME_BIOSES_DIRECTORY",
	"CACHE_DIR":                   "RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY",
	"CDN_CACHE":                   "RETROASSEMBLY_RUN_TIME_CDN_CACHE",
	"CDN_OFFLINE":                 "RETROASSEMBLY_RUN_TIME_CDN_OFFLINE",
	"CDN_PREFETCH":                "RETROASSEMBLY_RUN_TIME_CDN_PREFETCH",
	"CLIENT_DIR":                  "RETROASSEMBLY_GO_CLIENT_ROOT",
	"DATA_DIR":                    "RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY",
	"GAME_INFO_DB":                "RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE",
	"MAX_AUTO_STATES":             "RETROASSEMBLY_RUN_TIME_MAX_AUTO_STATES_PER_ROM",
	"MAX_ROMS":                    "RETROASSEMBLY_RUN_TIME_MAX_ROM_COUNT",
	"MAX_UPLOAD":                  "RETROASSEMBLY_RUN_TIME_MAX_UPLOAD_AT_ONCE",
	"MIGRATIONS_DIR":              "RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY",
	"OIDC_CLIENT_ID":              "RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_ID",
	"OIDC_CLIENT_SECRET":          "RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_SECRET",
	"OIDC_ISSUER":                 "RETROASSEMBLY_RUN_TIME_OIDC_ISSUER",
	"OIDC_LINK_PASSWORD_ACCOUNTS": "RETROASSEMBLY_RUN_TIME_OIDC_LINK_PASSWORD_ACCOUNTS",
	"OIDC_REDIRECT_URI":           "RETROASSEMBLY_RUN_TIME_OIDC_REDIRECT_URI",
	"OIDC_REQUIRED_ROLE":          "RETROASSEMBLY_RUN_TIME_OIDC_REQUIRED_ROLE",
	"OIDC_SCOPES":                 "RETROASSEMBLY_RUN_TIME_OIDC_SCOPES",
	"OIDC_SESSION_MAX_AGE":        "RETROASSEMBLY_RUN_TIME_OIDC_SESSION_MAX_AGE",
	"PORT":                        "RETROASSEMBLY_RUN_TIME_PORT",
	"ROMS_DIR":                    "RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY",
	"SAVES_DIR":                   "RETROASSEMBLY_RUN_TIME_GAME_SAVES_DIRECTORY",
	"STATES_DIR":                  "RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY",
	"STORAGE_DIR":                 "RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY",
	"STORAGE_HOST":                "RETROASSEMBLY_RUN_TIME_STORAGE_HOST",
}

// Get is a setting by its name, or by its old name when the new one is unset or empty
func Get(name string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return os.Getenv(Names[name])
}

// Lookup is a setting by its name, or by its old name, and whether either is set at all, even to nothing
func Lookup(name string) (string, bool) {
	if value, set := os.LookupEnv(name); set {
		return value, true
	}
	if old, known := Names[name]; known {
		return os.LookupEnv(old)
	}
	return "", false
}

type OIDC struct {
	ClientID     string
	ClientSecret string
	// A file of certificate authorities trusted for the provider besides the system's (NODE_EXTRA_CA_CERTS, which the
	// Node server trusts them from)
	ExtraCertificates string
	Issuer            string
	// Whether an identity may be linked to an account with a password that has its username
	LinkPasswordAccounts bool
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
	// Whether the server keeps its own copies of CDN files (CDN_CACHE)
	CDNCache bool
	// With the cache on, pages get only what's already in it (CDN_OFFLINE)
	CDNOffline bool
	// What the cache downloads when the server starts (CDN_PREFETCH)
	CDNPrefetch string
	// How many days a file found missing upstream is remembered before it's looked for again, 0 for forever
	// (CDN_RECHECK_DAYS, 30 by default)
	CDNRecheckDays float64
	// Whether downloaded images are kept as they came beside their WebP copy (CDN_KEEP_ORIGINALS, true unless "false")
	CDNKeepOriginals bool
	// The built browser app, dist/client
	ClientRoot  string
	Directories Directories
	// How many automatic save states are kept for each game
	MaxAutoStatesPerRom int
	// The SQL migrations Drizzle writes, src/databases/migrations
	MigrationsDirectory string
	OIDC                OIDC
	// The game service on the NAS, which runs games for players whose own device can't: its address (NAS_GAMES_URL)
	// and the key it expects (NAS_GAMES_KEY). Games on the NAS are off while either is unset
	NASGames NASGames
	// Whether anyone can create an account from the login page, not only the first (OPEN_SIGNUP)
	OpenSignup bool
	Port       int
	// Wrong passwords allowed for one username from one address in 15 minutes, 0 for no limit (SIGN_IN_ATTEMPTS, 10 by
	// default)
	SignInAttempts int
	// When set, stored files are sent from there instead of from disk
	StorageHost string
	// The sites that may show the app in a frame, as Content-Security-Policy's frame-ancestors lists them
	// (FRAME_ANCESTORS, 'self' by default)
	FrameAncestors string
}

// signInAttempts reads SIGN_IN_ATTEMPTS: 10 when unset or unreadable, and 0 (no limit) only when set to 0
func signInAttempts(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 10
	}
	if attempts, err := strconv.Atoi(value); err == nil && attempts >= 0 {
		return attempts
	}
	return 10
}

func env(name, fallback string) string {
	if value := Get(name); value != "" {
		return value
	}
	return fallback
}

// setOr is the setting, even when it's set to nothing, or fallback when it isn't set at all, as es-toolkit's defaults
// fills in the Node server's
func setOr(name, fallback string) string {
	if value, set := Lookup(name); set {
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

// recheckDays reads CDN_RECHECK_DAYS: a number of days, 0 for never; 30 when it's unset or isn't a number of days
func recheckDays(value string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 {
		return 30
	}
	return parsed
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
	dataDirectory := env("DATA_DIR", absolute("data"))
	// Not inside the data folder when only that is set: Node resolves the two separately
	storageDirectory := env("STORAGE_DIR", absolute("data", "storage"))
	artwork := Get("ARTWORK_DIR")
	attachments := filepath.Join(storageDirectory, "attachments")
	if artwork != "" {
		attachments = filepath.Join(artwork, "attachments")
	}

	port := 8000
	if parsed := jsNumber(Get("PORT")); parsed != 0 {
		port = parsed
	}

	return Config{
		CDNCache:         Get("CDN_CACHE") == "true",
		CDNOffline:       Get("CDN_OFFLINE") == "true",
		CDNPrefetch:      Get("CDN_PREFETCH"),
		CDNRecheckDays:   recheckDays(Get("CDN_RECHECK_DAYS")),
		CDNKeepOriginals: Get("CDN_KEEP_ORIGINALS") != "false",
		ClientRoot:       env("CLIENT_DIR", absolute("dist", "client")),
		Directories: Directories{
			Artwork:     artwork,
			Attachments: attachments,
			Bioses:      env("BIOSES_DIR", filepath.Join(storageDirectory, "bioses")),
			Cache:       env("CACHE_DIR", filepath.Join(dataDirectory, "cache")),
			Data:        dataDirectory,
			GameSaves:   env("SAVES_DIR", filepath.Join(storageDirectory, "game-saves")),
			Roms:        env("ROMS_DIR", filepath.Join(storageDirectory, "roms")),
			States:      env("STATES_DIR", filepath.Join(storageDirectory, "states")),
			Storage:     storageDirectory,
		},
		MaxAutoStatesPerRom: positiveInteger(Get("MAX_AUTO_STATES"), 20),
		MigrationsDirectory: env("MIGRATIONS_DIR", absolute("src", "databases", "migrations")),
		OIDC: OIDC{
			ClientID:             Get("OIDC_CLIENT_ID"),
			ClientSecret:         Get("OIDC_CLIENT_SECRET"),
			ExtraCertificates:    os.Getenv("NODE_EXTRA_CA_CERTS"),
			Issuer:               Get("OIDC_ISSUER"),
			LinkPasswordAccounts: Get("OIDC_LINK_PASSWORD_ACCOUNTS") == "true",
			RedirectURI:          Get("OIDC_REDIRECT_URI"),
			RequiredRole:         strings.TrimSpace(Get("OIDC_REQUIRED_ROLE")),
			Scopes:               setOr("OIDC_SCOPES", "openid profile email"),
			SessionMaxAge:        sessionMaxAge(env("OIDC_SESSION_MAX_AGE", "28800000")),
		},
		FrameAncestors: setOr("FRAME_ANCESTORS", "'self'"),
		NASGames:       NASGames{Key: Get("NAS_GAMES_KEY"), URL: strings.TrimSuffix(Get("NAS_GAMES_URL"), "/")},
		OpenSignup:     Get("OPEN_SIGNUP") == "true",
		Port:           port,
		SignInAttempts: signInAttempts(Get("SIGN_IN_ATTEMPTS")),
		StorageHost:    Get("STORAGE_HOST"),
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

// jsNumber reads a whole number as Math.trunc(Number(value)) did on the Node server: spaces around it, a fraction or an
// exponent ("8080.0", "8e3") and a 0x, 0o or 0b prefix are all accepted. Anything else is 0
func jsNumber(value string) int {
	value = strings.TrimSpace(value)
	if len(value) > 2 && value[0] == '0' && strings.ContainsRune("xXoObB", rune(value[1])) {
		parsed, err := strconv.ParseInt(value, 0, 64)
		if err != nil {
			return 0
		}
		return int(parsed)
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || strings.ContainsAny(value, "xXpP_") {
		return 0
	}
	return int(math.Trunc(parsed))
}
