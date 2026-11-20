package web

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"retroassembly/server/internal/config"
	"retroassembly/server/internal/db"
	"retroassembly/server/internal/shared"
)

// apiSetup is the whole server, as main starts it, on a data folder of its own and without the browser app
type apiSetup struct {
	app      *httptest.Server
	config   config.Config
	database *sql.DB
}

func newAPI(t *testing.T) *apiSetup {
	t.Helper()
	data := t.TempDir()
	migrations, err := filepath.Abs(filepath.Join("..", "..", "..", "src", "databases", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATA_DIR", data)
	t.Setenv("STORAGE_DIR", filepath.Join(data, "storage"))
	t.Setenv("CLIENT_DIR", filepath.Join(data, "no-client"))
	t.Setenv("MIGRATIONS_DIR", migrations)
	c := config.Load()

	database, err := db.Open(c.DatabasePath())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.Migrate(database, c.MigrationsDirectory); err != nil {
		t.Fatal(err)
	}
	shared, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(c, database, "local", shared)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	app := httptest.NewServer(handler)
	t.Cleanup(app.Close)
	return &apiSetup{app: app, config: c, database: database}
}

// apiUser is a browser signed in as one account
type apiUser struct {
	api    *apiSetup
	client *http.Client
	id     string
	t      *testing.T
}

func (a *apiSetup) browser(t *testing.T) *apiUser {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &apiUser{api: a, client: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}, t: t}
}

// register signs up a new account. The first one is the admin
func (a *apiSetup) register(t *testing.T, username string) *apiUser {
	t.Helper()
	user := a.browser(t)
	var answer struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	user.expectJSON(http.StatusOK, &answer, user.form(http.MethodPost, "/api/v1/auth/register",
		url.Values{"password": {"password-" + username}, "username": {username}}))
	user.id = answer.User.ID
	return user
}

// login signs in to an account made some other way
func (a *apiSetup) login(t *testing.T, username string) *apiUser {
	t.Helper()
	user := a.browser(t)
	var answer struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	user.expectJSON(http.StatusOK, &answer, user.form(http.MethodPost, "/api/v1/auth/login",
		url.Values{"password": {"password-" + username}, "username": {username}}))
	user.id = answer.User.ID
	return user
}

// response is an answer, read whole
type response struct {
	body   []byte
	status int
}

func (u *apiUser) send(method, path, contentType string, body io.Reader) response {
	u.t.Helper()
	request, err := http.NewRequest(method, u.api.app.URL+path, body)
	if err != nil {
		u.t.Fatal(err)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	answer, err := u.client.Do(request)
	if err != nil {
		u.t.Fatal(err)
	}
	defer answer.Body.Close()
	content, err := io.ReadAll(answer.Body)
	if err != nil {
		u.t.Fatal(err)
	}
	return response{body: content, status: answer.StatusCode}
}

func (u *apiUser) get(path string) response {
	return u.send(http.MethodGet, path, "", nil)
}

func (u *apiUser) form(method, path string, values url.Values) response {
	return u.send(method, path, "application/x-www-form-urlencoded", strings.NewReader(values.Encode()))
}

func (u *apiUser) json(method, path string, value any) response {
	u.t.Helper()
	content, err := json.Marshal(value)
	if err != nil {
		u.t.Fatal(err)
	}
	return u.send(method, path, "application/json", bytes.NewReader(content))
}

// upload is a file sent in a multipart form
type uploadFile struct {
	content []byte
	name    string
}

func (u *apiUser) multipart(method, path string, fields map[string]string, files map[string]uploadFile) response {
	u.t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			u.t.Fatal(err)
		}
	}
	for name, file := range files {
		part, err := writer.CreateFormFile(name, file.name)
		if err != nil {
			u.t.Fatal(err)
		}
		if _, err := part.Write(file.content); err != nil {
			u.t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		u.t.Fatal(err)
	}
	return u.send(method, path, writer.FormDataContentType(), &body)
}

// expect checks an answer's status, and is its body
func (u *apiUser) expect(status int, answer response) []byte {
	u.t.Helper()
	if answer.status != status {
		u.t.Fatalf("answered %d, not %d: %s", answer.status, status, answer.body)
	}
	return answer.body
}

func (u *apiUser) expectJSON(status int, value any, answer response) {
	u.t.Helper()
	body := u.expect(status, answer)
	if err := json.Unmarshal(body, value); err != nil {
		u.t.Fatalf("%v: %s", err, body)
	}
}

// game is a game as the API answers it, with the fields the tests look at
type game struct {
	FileID               string  `json:"fileId"`
	FileName             string  `json:"fileName"`
	GameBoxartFileIDs    *string `json:"gameBoxartFileIds"`
	GameName             *string `json:"gameName"`
	GamePlayers          *int    `json:"gamePlayers"`
	GameReleaseYear      *int    `json:"gameReleaseYear"`
	GameThumbnailFileIDs *string `json:"gameThumbnailFileIds"`
	ID                   string  `json:"id"`
	Platform             string  `json:"platform"`
}

// addGame uploads a NES game with the given name, its content made from the name so each is its own file
func (u *apiUser) addGame(fileName string) game {
	u.t.Helper()
	var added game
	u.expectJSON(http.StatusOK, &added, u.multipart(http.MethodPost, "/api/v1/roms", map[string]string{"platform": "nes"},
		map[string]uploadFile{"file": {content: []byte("NES\x1a" + fileName), name: fileName}}))
	return added
}

func (a *apiSetup) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := a.database.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
