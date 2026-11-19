package db

import (
	"os"
	"path/filepath"
	"testing"
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
