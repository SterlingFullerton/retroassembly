package db

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

var migrationsDirectory = filepath.Join("..", "..", "..", "src", "databases", "migrations")

func schema(t *testing.T, path string) map[string]string {
	t.Helper()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	rows, err := database.Query(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	tables := map[string]string{}
	for rows.Next() {
		var name, sql string
		if err := rows.Scan(&name, &sql); err != nil {
			t.Fatal(err)
		}
		tables[name] = sql
	}
	return tables
}

func TestMigrateFresh(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	migrations, err := readMigrations(migrationsDirectory)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := Migrate(database, migrationsDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if applied != len(migrations) {
		t.Fatalf("applied %d of %d migrations", applied, len(migrations))
	}
	again, err := Migrate(database, migrationsDirectory)
	if err != nil || again != 0 {
		t.Fatalf("a second run applied %d, %v", again, err)
	}
	var count int
	if err := database.QueryRow(`SELECT count(*) FROM __drizzle_migrations`).Scan(&count); err != nil || count != len(migrations) {
		t.Fatalf("%d migrations recorded, %v", count, err)
	}
}

// The schema Go makes is the one Drizzle makes, given a database the Node server set up (RETROASSEMBLY_NODE_DATABASE)
func TestMigrateMatchesNode(t *testing.T) {
	nodeDatabase := os.Getenv("RETROASSEMBLY_NODE_DATABASE")
	if nodeDatabase == "" {
		t.Skip("set RETROASSEMBLY_NODE_DATABASE to a database the Node server made")
	}
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(database, migrationsDirectory); err != nil {
		t.Fatal(err)
	}
	database.Close()
	ours, theirs := schema(t, path), schema(t, nodeDatabase)
	for name, sql := range theirs {
		if ours[name] != sql {
			t.Errorf("%s differs:\nGo:   %s\nNode: %s", name, ours[name], sql)
		}
	}
	for name := range ours {
		if _, ok := theirs[name]; !ok {
			t.Errorf("%s is only in the Go database", name)
		}
	}
}

// writeMigrations makes a migrations folder of the given tags, each adding a table of its name, at journal times 10, 20…
// unless a time is given as "tag@time"
func writeMigrations(t *testing.T, directory string, tags ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(directory, "meta"), 0o755); err != nil {
		t.Fatal(err)
	}
	entries := []string{}
	for index, tag := range tags {
		when := strconv.Itoa((index + 1) * 10)
		if name, at, found := strings.Cut(tag, "@"); found {
			tag, when = name, at
		}
		entries = append(entries, `{"tag": "`+tag+`", "when": `+when+`}`)
		statement := "CREATE TABLE `" + tag + "` (id text);"
		if err := os.WriteFile(filepath.Join(directory, tag+".sql"), []byte(statement), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	journal := `{"entries": [` + strings.Join(entries, ",") + `]}`
	if err := os.WriteFile(filepath.Join(directory, "meta", "_journal.json"), []byte(journal), 0o644); err != nil {
		t.Fatal(err)
	}
}

func tables(t *testing.T, path string) string {
	t.Helper()
	names := []string{}
	for name := range schema(t, path) {
		if name != "__drizzle_migrations" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return strings.Join(names, " ")
}

func backups(t *testing.T, path string) []string {
	t.Helper()
	found, err := filepath.Glob(path + ".before-*")
	if err != nil {
		t.Fatal(err)
	}
	for index := range found {
		found[index] = strings.TrimPrefix(found[index], path+".before-")
	}
	sort.Strings(found)
	return found
}

func TestMigrateCopiesTheDatabaseBeforeAnUpgrade(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	writeMigrations(t, migrations, "first")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	if found := backups(t, path); len(found) != 0 {
		t.Fatalf("a new database was copied: %v", found)
	}

	writeMigrations(t, migrations, "first", "second", "third")
	applied, err := Migrate(database, migrations)
	if err != nil || applied != 2 {
		t.Fatalf("applied %d, %v", applied, err)
	}
	if found := backups(t, path); len(found) != 1 || found[0] != "second" {
		t.Fatalf("copies are %v, want one named for the first migration applied", found)
	}
	if got := tables(t, path+".before-second"); got != "first" {
		t.Errorf("the copy has tables %q, want the database as it was", got)
	}
	if got := tables(t, path); got != "first second third" {
		t.Errorf("the database has tables %q", got)
	}

	// Nothing to apply: no copy
	if applied, err := Migrate(database, migrations); err != nil || applied != 0 {
		t.Fatalf("a second run applied %d, %v", applied, err)
	}
	if found := backups(t, path); len(found) != 1 {
		t.Errorf("copies are %v after a run with nothing to apply", found)
	}
}

// A copy from an earlier upgrade that was put back is older than the database's latest changes: it's set aside, and a
// fresh copy taken, so putting back the copy loses nothing written since
func TestMigrateTakesAFreshCopyOverAStaleOne(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	writeMigrations(t, migrations, "first")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	stale := path + ".before-second"
	if err := os.WriteFile(stale, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	writeMigrations(t, migrations, "first", "second")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	setAside := "second-" + old.Format("20060102-150405")
	if found := backups(t, path); strings.Join(found, " ") != "second "+setAside {
		t.Fatalf("copies are %v, want a fresh one and the old one set aside", found)
	}
	if got := tables(t, stale); got != "first" {
		t.Errorf("the copy has tables %q, want the database as it was", got)
	}
	if content, _ := os.ReadFile(path + ".before-" + setAside); string(content) != "stale" {
		t.Errorf("the old copy set aside holds %q", content)
	}
}

// A copy made after the database last changed is from an upgrade that failed, and is kept as it is
func TestMigrateKeepsACurrentCopy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	writeMigrations(t, migrations, "first")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	current := path + ".before-second"
	if err := os.WriteFile(current, []byte("current"), 0o644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(current, later, later); err != nil {
		t.Fatal(err)
	}
	writeMigrations(t, migrations, "first", "second")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	if found := backups(t, path); len(found) != 1 {
		t.Errorf("copies are %v, want the one there", found)
	}
	if content, _ := os.ReadFile(current); string(content) != "current" {
		t.Errorf("the copy holds %q, want it kept", content)
	}
}

// In WAL mode a read goes on while another connection is writing, rather than waiting for it
func TestOpenReadsWhileAWriteIsUnderWay(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "retroassembly.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var mode string
	if err := database.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal mode %q, %v", mode, err)
	}
	if _, err := database.Exec(`CREATE TABLE games (name text)`); err != nil {
		t.Fatal(err)
	}
	transaction, err := database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback()
	if _, err := transaction.Exec(`INSERT INTO games VALUES ('unsaved')`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := database.QueryRow(`SELECT count(*) FROM games`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("read %d games, %v; want 0 while the write isn't committed", count, err)
	}
}

func TestMigrateKeepsOnlyTheNewestCopies(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	tags := []string{"m0"}
	writeMigrations(t, migrations, tags...)
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	// A copy someone made by hand under another name is left alone
	manual := path + ".bak-mine"
	if err := os.WriteFile(manual, []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}
	for index := 1; index <= backupsKept+2; index++ {
		tags = append(tags, "m"+strconv.Itoa(index))
		writeMigrations(t, migrations, tags...)
		if _, err := Migrate(database, migrations); err != nil {
			t.Fatal(err)
		}
		// Told apart by when they were made
		old := time.Now().Add(time.Duration(index-100) * time.Hour)
		if err := os.Chtimes(path+".before-m"+strconv.Itoa(index), old, old); err != nil {
			t.Fatal(err)
		}
	}
	if found := backups(t, path); strings.Join(found, " ") != "m3 m4 m5 m6 m7" {
		t.Errorf("copies kept are %v", found)
	}
	if _, err := os.Stat(manual); err != nil {
		t.Errorf("the copy made by hand is gone: %v", err)
	}
}

func TestMigrateRefusesADatabaseFromANewerVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	newer, older := t.TempDir(), t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	writeMigrations(t, newer, "first", "second")
	writeMigrations(t, older, "first")
	if _, err := Migrate(database, newer); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(database, older); !errors.Is(err, ErrNewerDatabase) {
		t.Fatalf("an older version's answer is %v, want ErrNewerDatabase", err)
	}
	if got := tables(t, path); got != "first second" {
		t.Errorf("the database was changed: tables %q", got)
	}
}

func TestMigrateAppliesOneMergedInWithAnEarlierTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	writeMigrations(t, migrations, "first@10", "ours@30")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	writeMigrations(t, migrations, "first@10", "theirs@20", "ours@30")
	applied, err := Migrate(database, migrations)
	if err != nil || applied != 1 {
		t.Fatalf("applied %d, %v", applied, err)
	}
	if got := tables(t, path); got != "first ours theirs" {
		t.Errorf("the database has tables %q", got)
	}
}

// A migration whose file was edited after it was applied is still one the database has
func TestMigrateGoesByJournalTimeNotFileContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "retroassembly.sqlite")
	migrations := t.TempDir()
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	writeMigrations(t, migrations, "first")
	if _, err := Migrate(database, migrations); err != nil {
		t.Fatal(err)
	}
	edited := "CREATE TABLE `first` (id text); -- a comment added later"
	if err := os.WriteFile(filepath.Join(migrations, "first.sql"), []byte(edited), 0o644); err != nil {
		t.Fatal(err)
	}
	if applied, err := Migrate(database, migrations); err != nil || applied != 0 {
		t.Fatalf("applied %d, %v", applied, err)
	}
}
