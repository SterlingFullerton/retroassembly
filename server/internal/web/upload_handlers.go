package web

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/files"
	"retroassembly/server/internal/gameinfo"
	"retroassembly/server/internal/ids"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/psp"
)

// The limits busboy is given on the Node server: a game, and a few short fields
const (
	maxUploadFields    = 16
	maxUploadFieldSize = 64 * 1024
	maxUploadFiles     = 1
	staleUploadAge     = 24 * time.Hour
)

var multipartType = regexp.MustCompile(`(?i)^multipart/form-data`)

// upload is a file sent with a form, written to disk as it arrived
type upload struct {
	// The file's name by its content (files.Digest), worked out as it was written
	digest               string
	fileName, name, path string
	size                 int64
}

// uploadForm is a form with its files on disk
type uploadForm struct {
	fields map[string][]string
	files  map[string]*upload
	// Every file written, removed once the request is answered unless it was moved into storage
	written []*upload
}

func (f *uploadForm) remove() {
	for _, file := range f.written {
		os.Remove(file.path)
	}
}

// Browsers escape these characters in quoted names, and Request.formData() unescapes them
func decodeFormName(name string) string {
	return strings.NewReplacer("%0A", "\n", "%0a", "\n", "%0D", "\r", "%0d", "\r", "%22", `"`).Replace(name)
}

// removeStaleUploads removes files left behind by a process that stopped mid-upload. Only old files go, so uploads in
// progress in another process sharing the folder aren't affected
func removeStaleUploads(directory string) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() && time.Since(info.ModTime()) > staleUploadAge {
			os.Remove(filepath.Join(directory, entry.Name()))
		}
	}
}

var staleUploadsRemoved sync.Once

// readUpload reads a multipart form as src/utils/server/stream-form-data.ts does: files are written straight to disk
// as they arrive, rather than held in memory, and only a few short fields are taken. False when it has answered with
// an error
func (s *Server) readUpload(w http.ResponseWriter, r *http.Request) (*uploadForm, bool) {
	form := &uploadForm{fields: map[string][]string{}, files: map[string]*upload{}}
	// Games are the only files uploaded this way, so they arrive in the games folder: finishing an upload is then a
	// rename on the same disk, even when the games are on a different disk from everything else
	directory := filepath.Join(s.config.Directories.Roms, ".uploads")
	if err := os.MkdirAll(directory, 0o777); err != nil {
		writeError(w, err)
		return nil, false
	}
	staleUploadsRemoved.Do(func() {
		removeStaleUploads(directory)
		removeStaleUploads(filepath.Join(s.config.Directories.Storage, "tmp", "uploads"))
	})

	reader, err := r.MultipartReader()
	if err != nil {
		writeMessage(w, http.StatusBadRequest, "Malformed FormData request. "+err.Error())
		return nil, false
	}
	fieldCount, fileCount := 0, 0
	for {
		part, err := reader.NextRawPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			form.remove()
			writeMessage(w, http.StatusBadRequest, "Malformed FormData request. "+err.Error())
			return nil, false
		}
		_, parameters, _ := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		name := decodeFormName(parameters["name"])
		fileName, isFile := parameters["filename"]
		if !isFile {
			if fieldCount++; fieldCount > maxUploadFields {
				form.remove()
				writeMessage(w, http.StatusRequestEntityTooLarge, "Too many fields.")
				return nil, false
			}
			value, err := io.ReadAll(io.LimitReader(part, maxUploadFieldSize+1))
			if err != nil {
				form.remove()
				writeMessage(w, http.StatusBadRequest, "Malformed FormData request. "+err.Error())
				return nil, false
			}
			if len(value) > maxUploadFieldSize {
				form.remove()
				writeMessage(w, http.StatusRequestEntityTooLarge, "Field value too large.")
				return nil, false
			}
			form.fields[name] = append(form.fields[name], string(value))
			continue
		}
		if fileCount++; fileCount > maxUploadFiles {
			form.remove()
			writeMessage(w, http.StatusRequestEntityTooLarge, "Too many files.")
			return nil, false
		}
		file := &upload{fileName: decodeFormName(fileName), name: name, path: filepath.Join(directory, ids.New())}
		form.written = append(form.written, file)
		output, err := os.Create(file.path)
		if err != nil {
			form.remove()
			log.Println(err)
			writeMessage(w, http.StatusInternalServerError, "Failed to store the uploaded file.")
			return nil, false
		}
		hash := sha256.New()
		file.size, err = io.Copy(io.MultiWriter(output, hash), part)
		file.digest = files.DigestOf(hash)
		closeErr := output.Close()
		var pathError *os.PathError
		if errors.As(err, &pathError) || closeErr != nil {
			form.remove()
			log.Println(errors.Join(err, closeErr))
			writeMessage(w, http.StatusInternalServerError, "Failed to store the uploaded file.")
			return nil, false
		}
		if err != nil {
			form.remove()
			writeMessage(w, http.StatusBadRequest, "Malformed FormData request. "+err.Error())
			return nil, false
		}
		form.files[name] = file
	}
	return form, true
}

// truthy is JavaScript's truthiness, for the game info's values
func truthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case string:
		return v != ""
	case bool:
		return v
	case int64:
		return v != 0
	case float64:
		return v != 0 && !math.IsNaN(v)
	}
	return true
}

// either is JavaScript's a || b
func either(a, b any) any {
	if truthy(a) {
		return a
	}
	return b
}

func get(object library.Object, key string) any {
	if object == nil {
		return nil
	}
	return object.Get(key)
}

// withoutNulls is the info without the fields it doesn't have, as pickBy(item, isNotNil) leaves it
func withoutNulls(object library.Object) library.Object {
	if object == nil {
		return nil
	}
	kept := library.Object{}
	for _, field := range object {
		if field.Value != nil {
			kept = append(kept, field)
		}
	}
	return kept
}

// jsTruncNumber is Math.trunc(Number(value)), NaN for what isn't a number
func jsTruncNumber(value any) float64 {
	switch v := value.(type) {
	case nil:
		return 0
	case int64:
		return float64(v)
	case float64:
		return math.Trunc(v)
	case string:
		return math.Trunc(jsNumber(v))
	}
	return math.NaN()
}

func genresOf(launchbox library.Object) any {
	genres, ok := get(launchbox, "genres").(string)
	if !ok {
		return nil
	}
	parts := strings.Split(genres, ";")
	for i, part := range parts {
		parts[i] = gameinfo.Trim(part)
	}
	if joined := strings.Join(parts, ","); joined != "" {
		return joined
	}
	// libretro's database has no genres field, so nothing comes from it
	return nil
}

func releaseDateOf(launchbox library.Object) any {
	text, ok := get(launchbox, "releaseDate").(string)
	if !ok || text == "" {
		return nil
	}
	date, err := time.Parse(time.RFC3339Nano, text)
	if err != nil {
		return nil
	}
	return date.UnixMilli()
}

func releaseYearOf(launchbox, libretro library.Object) any {
	if launchbox != nil {
		if year := get(launchbox, "releaseYear"); truthy(year) {
			if result := jsTruncNumber(year); truthy(result) {
				return int64(result)
			}
		}
		if text, ok := get(launchbox, "releaseDate").(string); ok && text != "" {
			// The year where the server is, as new Date(...).getFullYear() reads it
			if date, err := time.Parse(time.RFC3339Nano, text); err == nil && date.Local().Year() != 0 {
				return int64(date.Local().Year())
			}
		}
	}
	if libretro != nil {
		year := get(libretro, "releaseyear")
		if year == nil {
			year = ""
		}
		if result := jsTruncNumber(year); truthy(result) {
			return int64(result)
		}
	}
	return nil
}

// maxRomCount is how many games a library may hold, Math.trunc(Number(...)) || Infinity: zero for no limit
func maxRomCount() float64 {
	count := jsTruncNumber(config.Get("MAX_ROMS"))
	if math.IsNaN(count) {
		return 0
	}
	return count
}

// POST /api/v1/roms: a game added to the library, as createRom adds it: looked up in the game info database, stored
// under its digest, and, for a PSP ISO, compressed afterwards
func (s *Server) createRom(w http.ResponseWriter, r *http.Request, scope library.Scope) {
	// Read-only users are refused before their upload is written to disk
	if err := library.AssertCanWrite(scope); err != nil {
		writeError(w, err)
		return
	}
	var (
		upload *upload
		fields url.Values
	)
	if multipartType.MatchString(r.Header.Get("Content-Type")) && r.Body != nil {
		form, ok := s.readUpload(w, r)
		if !ok {
			return
		}
		defer form.remove()
		upload, fields = form.files["file"], form.fields
	} else {
		if !parseForm(w, r, textBodyLimit) {
			return
		}
		fields = r.PostForm
	}

	var check validation
	if upload == nil {
		check.File("file", nil, fields, "File")
	}
	md5Value, md5Present := field(fields, "md5")
	md5, _ := check.OptionalString("md5", md5Value, md5Present, 0, 0)
	platformValue, platformPresent := field(fields, "platform")
	platform := check.String("platform", platformValue, platformPresent, 0)
	if check.Failed(w) {
		return
	}

	rom, err := s.addRom(r.Context(), scope, upload, md5, md5Present, platform)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rom)
}

func (s *Server) addRom(ctx context.Context, scope library.Scope, file *upload, md5 string, hasMD5 bool, platform string) (library.Object, error) {
	if err := library.AssertCanWrite(scope); err != nil {
		return nil, err
	}
	if limit := maxRomCount(); limit != 0 {
		count, err := library.CountRoms(ctx, scope)
		if err != nil {
			return nil, err
		}
		if float64(count+1) > limit {
			return nil, failure.New(http.StatusUnprocessableEntity,
				scope.T("error.exceedMaxRomCount", map[string]any{"maxRomCount": strconv.FormatFloat(limit, 'f', -1, 64)}))
		}
	}
	extensions, known := s.fileExtensions[platform]
	if !known {
		return nil, errors.New("Cannot read properties of undefined (reading 'fileExtensions')")
	}
	_, extension := gameinfo.ParsePath(file.fileName)
	extension = strings.ToLower(extension)
	supported := false
	for _, each := range extensions {
		supported = supported || each == extension
	}
	if !supported {
		return nil, failure.New(http.StatusUnprocessableEntity,
			fmt.Sprintf("File extension %s is not supported for platform %s", extension, platform))
	}

	// The game's info, from the game info database
	var launchbox, libretro library.Object
	hasLaunchbox := true
	if !hasMD5 {
		md5 = ""
	}
	results, err := s.gameInfo.Identify([]gameinfo.File{{MD5: &md5, Name: file.fileName}}, platform)
	if err != nil {
		log.Println(err)
	} else if len(results) > 0 {
		launchbox, libretro = results[0].Launchbox, results[0].Libretro
	}
	// Known to libretro but not matched in LaunchBox, which has the description: often only a revision or dump tag in
	// the name is in the way, so it's looked up again without them
	if libretro != nil && launchbox == nil {
		name, _ := libretro.Get("name").(string)
		launchbox = s.gameInfo.LaunchboxAgain(file.fileName, name, platform)
		// Not found again, LaunchBox's side is left out of what's stored, rather than kept as none
		hasLaunchbox = launchbox != nil
	}
	launchbox, libretro = withoutNulls(launchbox), withoutNulls(libretro)

	// The file, stored under its digest
	digest := file.digest
	fileID := path.Join("roms", platform, digest+extension)
	// A PSP disc uploaded before is already compressed; a new one is compressed once it's stored
	compressible := psp.IsCompressible(platform, fileID)
	if compressible && scope.Storage.Exists(psp.CsoFileID(fileID)) {
		fileID = psp.CsoFileID(fileID)
	} else if !scope.Storage.Exists(fileID) {
		destination, ok := scope.Storage.Path(fileID)
		if !ok {
			return nil, errors.New("Invalid file id")
		}
		if err := files.MoveFile(file.path, destination); err != nil {
			return nil, err
		}
	}

	discGroup, discNumber := library.DiscFields(s.multiDisc, platform, file.fileName)
	var fields []library.RomField
	add := func(column string, value any) {
		if value != nil {
			fields = append(fields, library.RomField{Column: column, Value: value})
		}
	}
	fields = append(fields, library.RomField{Column: "disc_group", Value: discGroup},
		library.RomField{Column: "disc_number", Value: discNumber})
	add("file_id", fileID)
	add("file_name", file.fileName)
	add("game_developer", either(get(launchbox, "developer"), get(libretro, "developer")))
	add("game_genres", genresOf(launchbox))
	add("game_name", either(get(launchbox, "name"), get(libretro, "name")))
	add("game_players", either(get(launchbox, "maxPlayers"), get(libretro, "users")))
	add("game_publisher", either(get(launchbox, "publisher"), get(libretro, "publisher")))
	add("game_release_date", releaseDateOf(launchbox))
	add("game_release_year", releaseYearOf(launchbox, libretro))
	add("launchbox_game_id", get(launchbox, "databaseId"))
	add("libretro_game_id", get(libretro, "id"))
	add("platform", platform)
	if launchbox != nil || libretro != nil {
		metadata := library.Object{}
		if hasLaunchbox {
			metadata = append(metadata, library.Field{Key: "launchbox", Value: nullable(launchbox)})
		}
		metadata = append(metadata, library.Field{Key: "libretro", Value: nullable(libretro)})
		add("raw_game_metadata", string(library.MustJSON(metadata)))
	}
	add("user_id", scope.User.ID)

	rom, err := library.SaveUploadedRom(ctx, scope, platform, file.fileName, fields)
	if err != nil {
		return nil, err
	}
	if compressible && fileID != psp.CsoFileID(fileID) {
		s.compressor.Compress(fileID)
	}
	// A new disc of a game may stand for it now (disc 1 added after disc 2), so its saves and history follow
	if rom.Get("discGroup") != nil {
		if err := library.UpdateDiscGroups(ctx, s.database, s.multiDiscList); err != nil {
			return nil, err
		}
	}
	return rom, nil
}

func nullable(object library.Object) any {
	if object == nil {
		return nil
	}
	return object
}

// BackfillGameInfo stores the game info for games matched before it was kept in the database, from the game info
// database, as backfillRawMetadata does. Run in the background once the server has started
func (s *Server) BackfillGameInfo() {
	rows, err := s.database.Query(`SELECT id, launchbox_game_id, libretro_game_id FROM roms
		WHERE status = 1 AND (raw_game_metadata IS NULL OR (raw_game_metadata IS NULL OR raw_game_metadata = ''))
			AND (launchbox_game_id IS NOT NULL OR libretro_game_id IS NOT NULL)`)
	if err != nil {
		log.Println("Filling in game info failed", err)
		return
	}
	type rom struct {
		id        string
		condition gameinfo.Condition
	}
	var roms []rom
	for rows.Next() {
		var (
			each      rom
			launchbox *int64
			libretro  *string
		)
		if err := rows.Scan(&each.id, &launchbox, &libretro); err != nil {
			rows.Close()
			log.Println("Filling in game info failed", err)
			return
		}
		each.condition = gameinfo.Condition{LaunchboxID: launchbox, LibretroID: libretro}
		roms = append(roms, each)
	}
	rows.Close()
	if len(roms) == 0 {
		return
	}
	log.Printf("Found %d ROMs needing metadata migration...", len(roms))
	log.Printf("Starting metadata migration for %d ROMs...", len(roms))
	var succeeded, failed int
	batches := (len(roms) + 99) / 100
	for batch := 0; batch < batches; batch++ {
		chunk := roms[batch*100 : min((batch+1)*100, len(roms))]
		log.Printf("Processing batch %d/%d (%d ROMs)...", batch+1, batches, len(chunk))
		conditions := make([]gameinfo.Condition, len(chunk))
		for i, each := range chunk {
			conditions[i] = each.condition
		}
		found, err := s.gameInfo.Query(conditions)
		if err != nil {
			log.Printf("Failed to fetch metadata for batch %d: %v", batch+1, err)
			failed += len(chunk)
			continue
		}
		if found == nil {
			log.Printf("No metadata returned for batch %d", batch+1)
			failed += len(chunk)
			continue
		}
		for i, each := range chunk {
			if _, err := s.database.Exec(`UPDATE roms SET raw_game_metadata = ?, updated_at = ? WHERE id = ?`,
				string(library.MustJSON(found[i])), time.Now().UnixMilli(), each.id); err != nil {
				log.Printf("Failed to update metadata: %v", err)
				failed++
				continue
			}
			succeeded++
		}
	}
	log.Println("Metadata Migration Completed")
	log.Printf("Successfully cached: %d ROMs", succeeded)
	log.Println("Skipped (no metadata available): 0 ROMs")
	log.Printf("Failed: %d ROMs", failed)
}

// StartBackgroundJobs starts what the Node server runs once it's listening: filling in game info, downloading CDN
// files, and compressing PSP games
func (s *Server) StartBackgroundJobs() {
	go func() {
		directories := s.config.Directories
		for _, folder := range []string{directories.Storage, directories.Roms, directories.Cache, directories.Artwork} {
			if removed := files.RemoveStaleTemporaries(folder, 24*time.Hour); removed > 0 {
				log.Printf("Removed %d unfinished files from %s", removed, folder)
			}
		}
	}()
	go s.BackfillGameInfo()
	// Images the cache kept as they came, from before CDN_KEEP_ORIGINALS=false, are converted once
	if s.cdn != nil && !s.cdn.KeepOriginals {
		go s.cdn.DropOriginals()
	}
	s.StartPrefetch()
	go func() {
		if err := s.compressor.CompressAll(); err != nil {
			log.Println("Compressing PSP games failed", err)
		}
	}()
}
