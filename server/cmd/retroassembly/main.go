// Command retroassembly is the Go server: the built browser app, the API, the CDN cache and the background jobs.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/config"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/library"
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

// moveUploadedArtwork moves box art uploaded before an artwork folder was set into it, once: the first time the server
// starts with the setting. Its ids stay the same, so nothing in the database changes
func moveUploadedArtwork(c config.Config) error {
	directories := c.Directories
	if directories.Artwork != "" && !c.CDNCache {
		log.Println("RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY holds only uploaded box art unless RETROASSEMBLY_RUN_TIME_CDN_CACHE=true: libretro art is otherwise loaded by the browser straight from libretro")
	}
	previous := filepath.Join(directories.Storage, "attachments")
	previousPath, _ := filepath.Abs(previous)
	attachmentsPath, _ := filepath.Abs(directories.Attachments)
	if directories.Artwork == "" || previousPath == attachmentsPath {
		return nil
	}
	if _, err := os.Stat(previous); err != nil {
		return nil
	}
	moved, err := files.MoveFolderContents(previous, directories.Attachments)
	if err != nil {
		return err
	}
	log.Printf("Moved %d uploaded box art files into the artwork folder", moved)
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
	if err := moveUploadedArtwork(c); err != nil {
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
	if err := library.UpdateDiscGroups(context.Background(), database, data.MultiDiscConsoles); err != nil {
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
	// On IPv6 as well as IPv4 where the system has both: in an Alpine container, "localhost" (as a health check asks
	// for it) is ::1 first
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", c.Port))
	if err != nil {
		return err
	}
	log.Printf("RetroAssembly is running at http://0.0.0.0:%d/", c.Port)
	// Jobs that need the internet start once the server is listening, so the library is up quickly even without it
	server.StartBackgroundJobs()

	httpServer := &http.Server{
		Handler: handler,
		// A client gets this long to send a request's headers, and a connection between requests stays open this long,
		// so slow or idle clients can't hold connections forever. A request's body has no time limit, as a large game
		// can take long to upload
		IdleTimeout:       2 * time.Minute,
		ReadHeaderTimeout: time.Minute,
	}
	// Stopped (as by docker stop), it finishes the requests under way for a few seconds before it exits
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGINT, syscall.SIGTERM)
	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(listener) }()
	select {
	case err := <-served:
		return err
	case <-stopped:
		log.Println("Stopping")
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		return httpServer.Shutdown(ctx)
	}
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
