// Package db opens the library's SQLite database and brings it up to date.
package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
			when:       entry.When,
		})
	}
	return migrations, nil
}

// Migrate applies the migrations in directory that the database doesn't have yet, exactly as Drizzle's migrator does,
// so the Node server and this one can take turns on the same database. Drizzle records each migration applied in
// __drizzle_migrations with its file's SHA-256 and its journal time, and applies every migration newer than the newest
// one recorded, all in one transaction
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
	var last sql.NullFloat64
	err = database.QueryRow(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`).Scan(&last)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
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
	for _, m := range migrations {
		if last.Valid && int64(last.Float64) >= m.when {
			continue
		}
		for _, statement := range m.statements {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if _, err = tx.Exec(statement); err != nil {
				return 0, fmt.Errorf("migration %s: %w", m.hash, err)
			}
		}
		if _, err = tx.Exec(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES(?, ?)`, m.hash, m.when); err != nil {
			return 0, err
		}
		applied++
	}
	return applied, tx.Commit()
}
