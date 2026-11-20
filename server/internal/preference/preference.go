// Package preference reads and saves a user's settings, as src/controllers/preference and src/constants/preference.ts
// do. Settings are kept as JSON objects, as the browser app sends and reads them.
package preference

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"sync"
	"time"

	"retroassembly/server/internal/db"
	"retroassembly/server/internal/ids"
)

// Object is a JSON object, read with its numbers kept as written
type Object = map[string]any

// Settings knows the defaults and the consoles, and remembers which consoles each library has
type Settings struct {
	defaults  Object
	platforms []string
	known     map[string]bool

	mutex sync.Mutex
	cache map[string]libraryPlatforms
}

type libraryPlatforms struct {
	at        time.Time
	platforms []string
}

// Decode reads JSON with its numbers kept as written
func Decode(content []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

// Encode writes JSON as JavaScript's JSON.stringify does: <, > and & as they are, and no trailing newline
func Encode(value any) []byte {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
}

func New(defaultPreference []byte, platforms []string) (*Settings, error) {
	defaults, err := Decode(defaultPreference)
	if err != nil {
		return nil, err
	}
	object, ok := defaults.(Object)
	if !ok {
		return nil, errors.New("the default preference is not an object")
	}
	known := map[string]bool{}
	for _, name := range platforms {
		known[name] = true
	}
	return &Settings{cache: map[string]libraryPlatforms{}, defaults: object, known: known, platforms: platforms}, nil
}

// clone copies a JSON value all the way down
func clone(value any) any {
	switch v := value.(type) {
	case Object:
		result := make(Object, len(v))
		for key, item := range v {
			result[key] = clone(item)
		}
		return result
	case []any:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = clone(item)
		}
		return result
	}
	return value
}

// truthy is JavaScript's truthiness for a JSON value
func truthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case json.Number:
		f, err := v.Float64()
		return err == nil && f != 0
	}
	return true
}

// Merge is mergePreference from src/utils/isomorphic/preference.ts: source's values over target's, objects merged key
// by key, arrays replaced, and a null in source removing the key
func Merge(target, source Object) Object {
	result := maps.Clone(target)
	if result == nil {
		result = Object{}
	}
	for key, value := range source {
		switch v := value.(type) {
		case nil:
			delete(result, key)
		case []any:
			result[key] = slices.Clone(v)
		case Object:
			existing, _ := result[key].(Object)
			result[key] = Merge(existing, v)
		default:
			result[key] = v
		}
	}
	return result
}

func section(object Object, key string) Object {
	value, _ := object[key].(Object)
	return value
}

// Resolve is resolveUserPreference: the user's own settings over the defaults. A keyboard mapping of their own
// replaces the default one whole, and a user who hasn't chosen their consoles gets the default ones
func (s *Settings) Resolve(user Object) Object {
	userPreference, _ := clone(user).(Object)
	if userPreference == nil {
		userPreference = Object{}
	}
	for _, key := range []string{"emulator", "ui", "input"} {
		if !truthy(userPreference[key]) {
			userPreference[key] = Object{}
		}
	}
	fallback := clone(s.defaults).(Object)
	if userInput := section(userPreference, "input"); userInput != nil && truthy(userInput["keyboardMapping"]) {
		if fallbackInput := section(fallback, "input"); fallbackInput != nil {
			delete(fallbackInput, "keyboardMapping")
		}
	}
	if ui := section(userPreference, "ui"); ui != nil && !truthy(ui["platforms"]) {
		delete(ui, "platforms")
	}
	return Merge(fallback, userPreference)
}

// Asked on every request, so kept for a short while; a console that gets its first games shows up within a minute
const libraryPlatformsMaxAge = time.Minute

// libraryPlatforms are the consoles that have games in a library, in the app's usual order
func (s *Settings) libraryPlatforms(ctx context.Context, database *sql.DB, libraryOwnerID string) ([]string, error) {
	s.mutex.Lock()
	cached, ok := s.cache[libraryOwnerID]
	s.mutex.Unlock()
	if ok && time.Since(cached.at) < libraryPlatformsMaxAge {
		return cached.platforms, nil
	}
	rows, err := database.QueryContext(ctx,
		`SELECT DISTINCT platform FROM roms WHERE user_id = ? AND status = ?`, libraryOwnerID, db.StatusNormal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var platform string
		if err := rows.Scan(&platform); err != nil {
			return nil, err
		}
		found[platform] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := []string{}
	for _, name := range s.platforms {
		if found[name] {
			result = append(result, name)
		}
	}
	s.mutex.Lock()
	s.cache[libraryOwnerID] = libraryPlatforms{at: time.Now(), platforms: result}
	s.mutex.Unlock()
	return result, nil
}

// withLibraryPlatforms: a player who hasn't chosen their consoles sees every console with games in the library they
// use (the admin's, for a shared player), so new consoles show up as games arrive. A list they chose is kept as it is.
// A library with no games yet keeps the usual starting set
func (s *Settings) withLibraryPlatforms(ctx context.Context, database *sql.DB, resolved Object, chosen bool, libraryOwnerID string) (Object, error) {
	if chosen {
		return resolved, nil
	}
	platforms, err := s.libraryPlatforms(ctx, database, libraryOwnerID)
	if err != nil {
		return nil, err
	}
	if len(platforms) > 0 {
		values := make([]any, len(platforms))
		for i, name := range platforms {
			values[i] = name
		}
		section(resolved, "ui")["platforms"] = values
	}
	return resolved, nil
}

// row is a user_preferences row's settings, each column an object or nil
type row struct {
	emulator, input, ui Object
}

func readColumn(value sql.NullString) (Object, error) {
	if !value.Valid {
		return nil, nil
	}
	decoded, err := Decode([]byte(value.String))
	if err != nil {
		return nil, err
	}
	object, _ := decoded.(Object)
	return object, nil
}

func scanRow(scanner interface{ Scan(...any) error }) (*row, error) {
	var emulator, input, ui sql.NullString
	if err := scanner.Scan(&emulator, &input, &ui); err != nil {
		return nil, err
	}
	var r row
	var err error
	if r.emulator, err = readColumn(emulator); err != nil {
		return nil, err
	}
	if r.input, err = readColumn(input); err != nil {
		return nil, err
	}
	if r.ui, err = readColumn(ui); err != nil {
		return nil, err
	}
	return &r, nil
}

// object is the row as resolveUserPreference takes it: columns that are NULL are there, as null
func (r *row) object() Object {
	object := Object{"emulator": nil, "input": nil, "ui": nil}
	if r.emulator != nil {
		object["emulator"] = r.emulator
	}
	if r.input != nil {
		object["input"] = r.input
	}
	if r.ui != nil {
		object["ui"] = r.ui
	}
	return object
}

func chosenPlatforms(r *row) bool {
	return r != nil && r.ui != nil && truthy(r.ui["platforms"])
}

// Get is a user's settings, resolved: getPreference
func (s *Settings) Get(ctx context.Context, database *sql.DB, userID, libraryOwnerID string) (Object, error) {
	r, err := scanRow(database.QueryRowContext(ctx,
		`SELECT emulator, input, ui FROM user_preferences WHERE user_id = ? AND status = ? LIMIT 1`,
		userID, db.StatusNormal))
	if errors.Is(err, sql.ErrNoRows) {
		r, err = nil, nil
	}
	if err != nil {
		return nil, err
	}
	var user Object
	if r != nil {
		// Consoles the app no longer has are left out
		if platforms, ok := r.ui["platforms"].([]any); ok {
			kept := []any{}
			for _, platform := range platforms {
				if name, ok := platform.(string); ok && s.known[name] {
					kept = append(kept, name)
				}
			}
			r.ui["platforms"] = kept
		}
		user = r.object()
	}
	resolved, err := s.withLibraryPlatforms(ctx, database, s.Resolve(user), chosenPlatforms(r), libraryOwnerID)
	if err != nil {
		return nil, err
	}
	return withLibraryBioses(ctx, database, resolved, userID, libraryOwnerID)
}

// LibraryBioses is the BIOS files in a library owner's settings, by console
func LibraryBioses(ctx context.Context, database *sql.DB, libraryOwnerID string) (map[string][]any, error) {
	owner, err := scanRow(database.QueryRowContext(ctx,
		`SELECT emulator, input, ui FROM user_preferences WHERE user_id = ? AND status = ? LIMIT 1`,
		libraryOwnerID, db.StatusNormal))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	bioses := map[string][]any{}
	for platform, value := range section(owner.emulator, "platform") {
		settings, _ := value.(Object)
		if list, _ := settings["bioses"].([]any); len(list) > 0 {
			bioses[platform] = list
		}
	}
	return bioses, nil
}

// withoutSharedBioses leaves out of settings being saved the BIOS files marked shared: they're the library owner's, and
// saved as the player's they would stay after the library is no longer shared
func withoutSharedBioses(snippet Object) {
	for _, value := range section(section(snippet, "emulator"), "platform") {
		settings, _ := value.(Object)
		bioses, ok := settings["bioses"].([]any)
		if !ok {
			continue
		}
		own := []any{}
		for _, item := range bioses {
			if bios, _ := item.(Object); bios == nil || bios["shared"] != true {
				own = append(own, item)
			}
		}
		settings["bioses"] = own
	}
}

// withLibraryBioses gives a player who shares another's library that library owner's BIOS files, on each console they
// haven't added any of their own for. Each is marked shared, as only its owner can remove it
func withLibraryBioses(ctx context.Context, database *sql.DB, resolved Object, userID, libraryOwnerID string) (Object, error) {
	if libraryOwnerID == "" || libraryOwnerID == userID {
		return resolved, nil
	}
	owned, err := LibraryBioses(ctx, database, libraryOwnerID)
	if err != nil {
		return nil, err
	}
	platforms := section(section(resolved, "emulator"), "platform")
	for platform, bioses := range owned {
		settings, ok := platforms[platform].(Object)
		if !ok {
			continue
		}
		if own, _ := settings["bioses"].([]any); len(own) == 0 {
			shared := clone(bioses).([]any)
			for _, item := range shared {
				if bios, ok := item.(Object); ok {
					bios["shared"] = true
				}
			}
			settings["bioses"] = shared
		}
	}
	return resolved, nil
}

// normalize puts chosen consoles in the app's usual order and leaves out the ones it doesn't have; null removes them
func (s *Settings) normalize(preference Object) {
	ui := section(preference, "ui")
	if ui == nil {
		return
	}
	value, present := ui["platforms"]
	if !present {
		return
	}
	if value == nil {
		delete(ui, "platforms")
		return
	}
	chosen, ok := value.([]any)
	if !ok {
		return
	}
	sorted := []any{}
	for _, name := range s.platforms {
		if slices.Contains(chosen, any(name)) {
			sorted = append(sorted, name)
		}
	}
	ui["platforms"] = sorted
}

func column(value any) any {
	if value == nil {
		return nil
	}
	return string(Encode(value))
}

// Update saves part of a user's settings over what they have, and is their settings, resolved: updatePreference
func (s *Settings) Update(ctx context.Context, database *sql.DB, userID, libraryOwnerID string, snippet Object) (Object, error) {
	withoutSharedBioses(snippet)
	existing, err := scanRow(database.QueryRowContext(ctx,
		`SELECT emulator, input, ui FROM user_preferences WHERE user_id = ? LIMIT 1`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		existing, err = nil, nil
	}
	if err != nil {
		return nil, err
	}
	now := db.Millis(time.Now())
	var saved *row
	if existing != nil {
		changed := Object{}
		current := map[string]Object{"emulator": existing.emulator, "input": existing.input, "ui": existing.ui}
		for _, key := range []string{"emulator", "input", "ui"} {
			if !truthy(snippet[key]) {
				continue
			}
			part, _ := snippet[key].(Object)
			changed[key] = Merge(current[key], part)
		}
		s.normalize(changed)
		set, arguments := "user_id = ?, updated_at = ?", []any{userID, now}
		for _, key := range []string{"emulator", "input", "ui"} {
			if value, ok := changed[key]; ok {
				set += ", " + key + " = ?"
				arguments = append(arguments, column(value))
			}
		}
		arguments = append(arguments, userID)
		saved, err = scanRow(database.QueryRowContext(ctx,
			`UPDATE user_preferences SET `+set+` WHERE user_id = ? RETURNING emulator, input, ui`, arguments...))
	} else {
		inserted := maps.Clone(snippet)
		if ui := section(snippet, "ui"); ui != nil {
			inserted["ui"] = maps.Clone(ui)
		}
		s.normalize(inserted)
		saved, err = scanRow(database.QueryRowContext(ctx, `
			INSERT INTO user_preferences (emulator, input, ui, user_id, created_at, id, status, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING emulator, input, ui`,
			column(inserted["emulator"]), column(inserted["input"]), column(inserted["ui"]), userID, now, ids.New(),
			db.StatusNormal, now))
	}
	if err != nil {
		return nil, err
	}
	resolved, err := s.withLibraryPlatforms(ctx, database, s.Resolve(saved.object()), chosenPlatforms(saved), libraryOwnerID)
	if err != nil {
		return nil, err
	}
	return withLibraryBioses(ctx, database, resolved, userID, libraryOwnerID)
}
