// Package db opens the library's SQLite database and brings it up to date.
package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// StatusNormal and StatusDeleted are the status column's values. Rows are never removed, only marked deleted
const (
	StatusDeleted = 0
	StatusNormal  = 1
)

// Open opens the database, waiting up to 5 seconds for a backup or a script holding the file rather than failing
func Open(path string) (*sql.DB, error) {
	dsn := (&url.URL{Scheme: "file", Opaque: path, RawQuery: "_pragma=busy_timeout(5000)"}).String()
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection, as the Node server has: SQLite allows one writer at a time anyway
	database.SetMaxOpenConns(1)
	if err := database.Ping(); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

// Millis is a time as the database stores it: integer milliseconds since 1970, as Drizzle's timestamp_ms columns
func Millis(t time.Time) int64 {
	return t.UnixMilli()
}

// Time reads a timestamp_ms column
func Time(millis int64) time.Time {
	return time.UnixMilli(millis)
}

type journal struct {
	Entries []struct {
		Tag  string `json:"tag"`
		When int64  `json:"when"`
	} `json:"entries"`
}

type migration struct {
	hash       string
	statements []string
	tag        string
	when       int64
}

func readMigrations(directory string) ([]migration, error) {
	content, err := os.ReadFile(filepath.Join(directory, "meta", "_journal.json"))
	if err != nil {
		return nil, fmt.Errorf("can't find meta/_journal.json: %w", err)
	}
	var j journal
	if err := json.Unmarshal(content, &j); err != nil {
		return nil, err
	}
	migrations := make([]migration, 0, len(j.Entries))
	for _, entry := range j.Entries {
		query, err := os.ReadFile(filepath.Join(directory, entry.Tag+".sql"))
		if err != nil {
			return nil, fmt.Errorf("no file %s.sql found in %s: %w", entry.Tag, directory, err)
		}
		sum := sha256.Sum256(query)
		migrations = append(migrations, migration{
			hash:       hex.EncodeToString(sum[:]),
			statements: strings.Split(string(query), "--> statement-breakpoint"),
			tag:        entry.Tag,
			when:       entry.When,
		})
	}
	return migrations, nil
}

// ErrNewerDatabase is Migrate's answer to a database a newer version has upgraded: this one doesn't know its tables
var ErrNewerDatabase = errors.New("the database was upgraded by a newer version of RetroAssembly")

// backupsKept is how many of the copies made before upgrades are kept; older ones are removed
const backupsKept = 5

// Migrate applies the migrations in directory that the database doesn't have yet, all in one transaction, and records
// each as Drizzle's migrator does (its file's SHA-256 and its journal time in __drizzle_migrations), so a database the
// Node server set up carries on.
//
// A migration is one the database has when its journal time is recorded. Drizzle applies only those newer than the
// newest recorded, which passes over one merged in later with an earlier time; here that one is applied too.
//
// Before a database in use is changed, it's copied beside itself as <file>.before-<first migration applied>, which is
// what to put back to return to the version before. A database with a migration newer than any in directory was
// upgraded by a newer version, and is refused with ErrNewerDatabase rather than run with tables this one doesn't expect
func Migrate(database *sql.DB, directory string) (applied int, err error) {
	migrations, err := readMigrations(directory)
	if err != nil {
		return 0, err
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			)`); err != nil {
		return 0, err
	}
	recorded, err := recordedMigrations(database)
	if err != nil {
		return 0, err
	}
	var newestKnown int64
	for _, m := range migrations {
		newestKnown = max(newestKnown, m.when)
	}
	for when := range recorded {
		if when > newestKnown {
			return 0, fmt.Errorf("%w: start that version, or put back the copy of the database made before it upgraded (%s)",
				ErrNewerDatabase, backupPattern(database))
		}
	}
	var pending []migration
	for _, m := range migrations {
		if !recorded[m.when] {
			pending = append(pending, m)
		}
	}
	if len(pending) == 0 {
		return 0, nil
	}
	// A new database has nothing to keep
	if len(recorded) > 0 {
		if err := backup(database, pending[0].tag); err != nil {
			return 0, fmt.Errorf("the database wasn't upgraded, as it couldn't be copied first: %w", err)
		}
	}

	tx, err := database.Begin()
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()
	for _, m := range pending {
		for _, statement := range m.statements {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if _, err = tx.Exec(statement); err != nil {
				return 0, fmt.Errorf("migration %s: %w", m.tag, err)
			}
		}
		if _, err = tx.Exec(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES(?, ?)`, m.hash, m.when); err != nil {
			return 0, err
		}
		applied++
	}
	return applied, tx.Commit()
}

// recordedMigrations are the journal times of the migrations the database has
func recordedMigrations(database *sql.DB) (map[int64]bool, error) {
	rows, err := database.Query(`SELECT created_at FROM "__drizzle_migrations"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	recorded := map[int64]bool{}
	for rows.Next() {
		var when sql.NullFloat64
		if err := rows.Scan(&when); err != nil {
			return nil, err
		}
		if when.Valid {
			recorded[int64(when.Float64)] = true
		}
	}
	return recorded, rows.Err()
}

// databaseFile is the file the database is kept in; empty for one in memory
func databaseFile(database *sql.DB) (string, error) {
	rows, err := database.Query(`PRAGMA database_list`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var sequence int
		var name, file string
		if err := rows.Scan(&sequence, &name, &file); err != nil {
			return "", err
		}
		if name == "main" {
			return file, nil
		}
	}
	return "", rows.Err()
}

const backupInfix = ".before-"

// backupPattern says where the copies made before upgrades are, for a message
func backupPattern(database *sql.DB) string {
	file, err := databaseFile(database)
	if err != nil || file == "" {
		return "<database>" + backupInfix + "*"
	}
	return file + backupInfix + "*"
}

// backup copies the database beside itself before the migration named is applied, and removes all but the newest
// copies. One already there is kept: it was made by an upgrade that then failed, so it holds the same database
func backup(database *sql.DB, tag string) error {
	file, err := databaseFile(database)
	if err != nil || file == "" {
		return err
	}
	target := file + backupInfix + tag
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	// Written under another name first, so a copy cut short is never taken for a whole one
	partial := target + ".partial"
	if err := os.Remove(partial); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if _, err := database.Exec(`VACUUM INTO ?`, partial); err != nil {
		os.Remove(partial)
		return err
	}
	if err := os.Rename(partial, target); err != nil {
		return err
	}
	log.Printf("Copied the database to %s before upgrading it", target)
	// The copy is made, so the upgrade goes ahead whether or not older copies could be cleared
	if err := removeOldBackups(file); err != nil {
		log.Printf("Couldn't remove older copies of the database: %v", err)
	}
	return nil
}

func removeOldBackups(file string) error {
	copies, err := filepath.Glob(file + backupInfix + "*")
	if err != nil {
		return err
	}
	type copyOf struct {
		path     string
		modified time.Time
	}
	var kept []copyOf
	for _, path := range copies {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || strings.HasSuffix(path, ".partial") {
			continue
		}
		kept = append(kept, copyOf{path, info.ModTime()})
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].modified.After(kept[j].modified) })
	for index, each := range kept {
		if index >= backupsKept {
			if err := os.Remove(each.path); err != nil {
				return err
			}
		}
	}
	return nil
}
