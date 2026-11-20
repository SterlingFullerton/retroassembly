// Command retroassembly is the Go server. It serves the built browser app and the API, but for uploading games and the
// CDN cache, which are still the Node server's.
package main

import (
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"golang.org/x/sys/unix"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/shared"
	"retroassembly/server/internal/web"
)

func inDocker() bool {
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

// checkDirectories makes sure the data folder, and each folder set for a kind of file, is there and writable, as a
// missing mount would otherwise only show up when a game, save or snapshot fails to load or save
func checkDirectories(c config.Config) error {
	if _, err := os.Stat(c.Directories.Data); err != nil {
		message := fmt.Sprintf("Data directory %s does not exist.", c.Directories.Data)
		if inDocker() {
			message += fmt.Sprintf("\nAs you are using Docker, make sure to mount the data directory with \"--volume <data_directory_path>:%s\".", c.Directories.Data)
		}
		return errors.New(message)
	}
	var messages []string
	for setting := range config.DirectorySettings {
		directory := os.Getenv(setting)
		if directory == "" {
			continue
		}
		if _, err := os.Stat(directory); err != nil {
			messages = append(messages, fmt.Sprintf("%s is set to %s, which does not exist.", setting, directory))
			continue
		}
		if unix.Access(directory, unix.W_OK) != nil {
			messages = append(messages, fmt.Sprintf("%s is set to %s, which can't be written to.", setting, directory))
		}
	}
	if len(messages) > 0 {
		if inDocker() {
			messages = append(messages, "As you are using Docker, make sure each of these folders is mounted, and not read-only.")
		}
		return errors.New(strings.Join(messages, "\n"))
	}
	return nil
}

func run() error {
	c := config.Load()
	authMode, err := c.AuthMode()
	if err != nil {
		return err
	}
	if err := checkDirectories(c); err != nil {
		return err
	}
	database, err := db.Open(c.DatabasePath())
	if err != nil {
		return err
	}
	defer database.Close()
	if _, err := db.Migrate(database, c.MigrationsDirectory); err != nil {
		return err
	}
	data, err := shared.Load()
	if err != nil {
		return err
	}
	server, err := web.New(c, database, authMode, data)
	if err != nil {
		return err
	}
	handler, err := server.Handler()
	if err != nil {
		return err
	}
	if c.NodeURL != "" {
		log.Printf("Passing what isn't ported yet to the Node server at %s", c.NodeURL)
	}
	// IPv4 only, as the Node server listens
	address := fmt.Sprintf("0.0.0.0:%d", c.Port)
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		return err
	}
	log.Printf("RetroAssembly (Go) is running at http://%s/", address)
	return http.Serve(listener, handler)
}

func main() {
	log.SetFlags(0)
	// Started by the server itself to hash one password (see auth.UseChildProcess)
	if len(os.Args) == 2 && os.Args[1] == auth.ChildArgument {
		if err := auth.RunChild(os.Stdin, os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	auth.UseChildProcess(executable)
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
