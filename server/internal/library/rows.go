package library

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"

	"retroassembly/server/internal/auth"
	"retroassembly/server/internal/db"
)

// Field is one key of an Object
type Field struct {
	Key   string
	Value any
}

// Object is a JSON object with its keys in a set order: the order the Node server's answers have them in
type Object []Field

func (o Object) MarshalJSON() ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	for i, field := range o {
		if i > 0 {
			buffer.WriteByte(',')
		}
		key, _ := json.Marshal(field.Key)
		buffer.Write(key)
		buffer.WriteByte(':')
		var value bytes.Buffer
		encoder := json.NewEncoder(&value)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(field.Value); err != nil {
			return nil, err
		}
		buffer.Write(bytes.TrimSuffix(value.Bytes(), []byte("\n")))
	}
	buffer.WriteByte('}')
	return buffer.Bytes(), nil
}

// mustJSON is a value as JSON, as JSON.stringify writes it
func mustJSON(value any) []byte {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
}

// sqlNumber is a number as SQLite takes it for LIMIT and OFFSET: whole numbers as integers
func sqlNumber(n float64) any {
	if n == math.Trunc(n) && !math.IsInf(n, 0) {
		return int64(n)
	}
	return n
}

// Get is a key's value, or nil
func (o Object) Get(key string) any {
	for _, field := range o {
		if field.Key == key {
			return field.Value
		}
	}
	return nil
}

// Set changes a key's value, or adds the key at the end
func (o *Object) Set(key string, value any) {
	for i, field := range *o {
		if field.Key == key {
			(*o)[i].Value = value
			return
		}
	}
	*o = append(*o, Field{Key: key, Value: value})
}

// How a column is read: as it is, as a timestamp_ms (a date, written as JavaScript writes one), or as JSON text
type columnKind int

const (
	plain columnKind = iota
	timestamp
	jsonText
)

type column struct {
	key  string
	kind columnKind
	sql  string
}

// The roms table's columns, in the order the Node server's schema lists them
var romColumns = []column{
	{"discGroup", plain, "disc_group"},
	{"discNumber", plain, "disc_number"},
	{"fileName", plain, "file_name"},
	{"gameBoxartFileIds", plain, "game_boxart_file_ids"},
	{"gameDescription", plain, "game_description"},
	{"gameDeveloper", plain, "game_developer"},
	{"gameGenres", plain, "game_genres"},
	{"gameName", plain, "game_name"},
	{"gamePlayers", plain, "game_players"},
	{"gamePublisher", plain, "game_publisher"},
	{"gameRating", plain, "game_rating"},
	{"gameReleaseDate", timestamp, "game_release_date"},
	{"gameReleaseYear", plain, "game_release_year"},
	{"gameThumbnailFileIds", plain, "game_thumbnail_file_ids"},
	{"gameTitle", plain, "game_title"},
	{"launchboxGameId", plain, "launchbox_game_id"},
	{"libretroGameId", plain, "libretro_game_id"},
	{"platform", plain, "platform"},
	{"rawGameMetadata", jsonText, "raw_game_metadata"},
	{"createdAt", timestamp, "created_at"},
	{"id", plain, "id"},
	{"status", plain, "status"},
	{"updatedAt", timestamp, "updated_at"},
	{"fileId", plain, "file_id"},
	{"userId", plain, "user_id"},
}

// selectColumns lists columns for a SELECT, each prefixed with a table's name or alias
func selectColumns(table string, columns []column) string {
	names := make([]string, len(columns))
	for i, c := range columns {
		names[i] = c.sql
		if table != "" && !strings.ContainsAny(c.sql, "( ") {
			names[i] = table + "." + c.sql
		}
	}
	return strings.Join(names, ", ")
}

// normalizeJSON writes JSON text as JavaScript's JSON.stringify(JSON.parse(text)) would: keys in their order, numbers
// as JavaScript writes them (2.0 as 2), no spaces. Go writes float64 as JavaScript does
func normalizeJSON(text string) (json.RawMessage, error) {
	decoder := json.NewDecoder(strings.NewReader(text))
	var buffer bytes.Buffer
	// What each open object or array has written so far: 0 nothing, 1 a value (or key and value), 2 a key
	var stack []int
	separate := func() {
		if len(stack) == 0 {
			return
		}
		top := &stack[len(stack)-1]
		switch *top {
		case 1:
			buffer.WriteByte(',')
		case 2:
			buffer.WriteByte(':')
		}
	}
	// After a value: an object's key waits for its value, anything else is done
	wrote := func(isKey bool) {
		if len(stack) == 0 {
			return
		}
		if isKey {
			stack[len(stack)-1] = 2
		} else {
			stack[len(stack)-1] = 1
		}
	}
	inObject := []bool{}
	for {
		token, err := decoder.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, err
		}
		switch t := token.(type) {
		case json.Delim:
			switch t {
			case '{', '[':
				separate()
				buffer.WriteByte(byte(t))
				stack = append(stack, 0)
				inObject = append(inObject, t == '{')
			case '}', ']':
				buffer.WriteByte(byte(t))
				stack, inObject = stack[:len(stack)-1], inObject[:len(inObject)-1]
				wrote(false)
			}
		default:
			isKey := len(inObject) > 0 && inObject[len(inObject)-1] && stack[len(stack)-1] != 2
			separate()
			var encoded []byte
			if number, ok := t.(float64); ok {
				encoded, err = json.Marshal(number)
			} else {
				var value bytes.Buffer
				encoder := json.NewEncoder(&value)
				encoder.SetEscapeHTML(false)
				err = encoder.Encode(t)
				encoded = bytes.TrimSuffix(value.Bytes(), []byte("\n"))
			}
			if err != nil {
				return nil, err
			}
			buffer.Write(encoded)
			wrote(isKey)
		}
	}
	return buffer.Bytes(), nil
}

// value is a column's value as the Node server answers it
func value(raw any, kind columnKind) any {
	if raw == nil {
		return nil
	}
	if text, ok := raw.([]byte); ok {
		raw = string(text)
	}
	switch kind {
	case timestamp:
		switch millis := raw.(type) {
		case int64:
			return auth.JSTime(db.Time(millis))
		case float64:
			return auth.JSTime(db.Time(int64(millis)))
		}
	case jsonText:
		if text, ok := raw.(string); ok {
			if normalized, err := normalizeJSON(text); err == nil {
				return normalized
			}
		}
	}
	return raw
}

// scanObject reads a row of the given columns, and any more scanned after them into extra
func scanObject(scanner interface{ Scan(...any) error }, columns []column, extra ...any) (Object, error) {
	raw := make([]any, len(columns))
	targets := make([]any, 0, len(columns)+len(extra))
	for i := range raw {
		targets = append(targets, &raw[i])
	}
	targets = append(targets, extra...)
	if err := scanner.Scan(targets...); err != nil {
		return nil, err
	}
	object := make(Object, len(columns))
	for i, c := range columns {
		object[i] = Field{Key: c.key, Value: value(raw[i], c.kind)}
	}
	return object, nil
}

type sqlRows = sql.Rows

// queryObjects runs a query and reads each of its rows with read
func queryObjects(ctx context.Context, database *sql.DB, read func(*sql.Rows) (Object, error), query string, arguments ...any) ([]Object, error) {
	rows, err := database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	objects := []Object{}
	for rows.Next() {
		object, err := read(rows)
		if err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, rows.Err()
}
