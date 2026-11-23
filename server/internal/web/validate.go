package web

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// The issues zod reports, with their fields in zod's order, so a request the Node server refuses is refused in the same
// words
type typeIssue struct {
	Expected string   `json:"expected"`
	Code     string   `json:"code"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

type fileIssue struct {
	Code     string   `json:"code"`
	Expected string   `json:"expected"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

type tooSmallIssue struct {
	Origin    string   `json:"origin"`
	Code      string   `json:"code"`
	Minimum   int      `json:"minimum"`
	Inclusive bool     `json:"inclusive"`
	Path      []string `json:"path"`
	Message   string   `json:"message"`
}

type tooBigIssue struct {
	Origin    string   `json:"origin"`
	Code      string   `json:"code"`
	Maximum   int      `json:"maximum"`
	Inclusive bool     `json:"inclusive"`
	Path      []string `json:"path"`
	Message   string   `json:"message"`
}

type enumIssue struct {
	Code    string   `json:"code"`
	Values  []string `json:"values"`
	Path    []string `json:"path"`
	Message string   `json:"message"`
}

type nanIssue struct {
	Expected string   `json:"expected"`
	Code     string   `json:"code"`
	Received string   `json:"received"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

type intIssue struct {
	Expected string   `json:"expected"`
	Code     string   `json:"code"`
	Format   string   `json:"format"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

type numberTooSmallIssue struct {
	Origin    string   `json:"origin"`
	Code      string   `json:"code"`
	Minimum   int      `json:"minimum"`
	Inclusive bool     `json:"inclusive"`
	Path      []string `json:"path"`
	Message   string   `json:"message"`
}

// received is how zod names the type of a value it didn't expect
func received(value any, present bool) string {
	if !present {
		return "undefined"
	}
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case json.Number, float64:
		return "number"
	case []any:
		return "array"
	}
	return "object"
}

// validation collects what's wrong with a request, as zod does, field by field
type validation struct {
	issues []any
}

// String checks a field is a string of at least minimum characters
func (v *validation) String(name string, value any, present bool, minimum int) string {
	text, ok := value.(string)
	if !present || !ok {
		v.issues = append(v.issues, typeIssue{
			Expected: "string", Code: "invalid_type", Path: []string{name},
			Message: "Invalid input: expected string, received " + received(value, present),
		})
		return ""
	}
	if len([]rune(text)) < minimum {
		v.issues = append(v.issues, tooSmallIssue{
			Origin: "string", Code: "too_small", Minimum: minimum, Inclusive: true, Path: []string{name},
			Message: "Too small: expected string to have >=" + itoa(minimum) + " characters",
		})
	}
	return text
}

// OptionalString checks an optional field is, when it's there, a string of minimum to maximum characters (no maximum
// for 0)
func (v *validation) OptionalString(name string, value any, present bool, minimum, maximum int) (string, bool) {
	if !present {
		return "", false
	}
	text := v.String(name, value, present, minimum)
	if maximum > 0 && len([]rune(text)) > maximum {
		v.issues = append(v.issues, tooBigIssue{
			Origin: "string", Code: "too_big", Maximum: maximum, Inclusive: true, Path: []string{name},
			Message: "Too big: expected string to have <=" + itoa(maximum) + " characters",
		})
	}
	return text, true
}

// Enum checks a field is one of values, which zod lists in the schema's order
func (v *validation) Enum(name string, value any, present bool, values ...string) string {
	if text, ok := value.(string); ok && present {
		for _, allowed := range values {
			if text == allowed {
				return text
			}
		}
	}
	quoted := make([]string, len(values))
	for i, allowed := range values {
		quoted[i] = `"` + allowed + `"`
	}
	v.issues = append(v.issues, enumIssue{
		Code: "invalid_value", Values: values, Path: []string{name},
		Message: "Invalid option: expected one of " + strings.Join(quoted, "|"),
	})
	return ""
}

// OptionalInt checks an optional field is, when it's there, a whole number of at least minimum, read from text as
// z.coerce.number() reads it
func (v *validation) OptionalInt(name string, value any, present bool, minimum int) (int64, bool) {
	if !present {
		return 0, false
	}
	text, _ := value.(string)
	number := 0.0
	if trimmed := strings.TrimSpace(text); trimmed != "" {
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			parsed = math.NaN()
		}
		number = parsed
	}
	switch {
	case math.IsNaN(number):
		v.issues = append(v.issues, nanIssue{
			Expected: "number", Code: "invalid_type", Received: "NaN", Path: []string{name},
			Message: "Invalid input: expected number, received NaN",
		})
	case number != math.Trunc(number) || math.IsInf(number, 0):
		v.issues = append(v.issues, intIssue{
			Expected: "int", Code: "invalid_type", Format: "safeint", Path: []string{name},
			Message: "Invalid input: expected int, received number",
		})
	case number < float64(minimum):
		v.issues = append(v.issues, numberTooSmallIssue{
			Origin: "number", Code: "too_small", Minimum: minimum, Inclusive: true, Path: []string{name},
			Message: "Too small: expected number to be >=" + itoa(minimum),
		})
	}
	return int64(number), true
}

// File checks a field is an uploaded file. expected is how the schema names it: File, or Blob
func (v *validation) File(name string, file *multipart.FileHeader, values url.Values, expected string) {
	if file != nil {
		return
	}
	_, isText := values[name]
	v.issues = append(v.issues, fileIssue{
		Code: "invalid_type", Expected: expected, Path: []string{name},
		Message: "Invalid input: expected " + expected + ", received " + received("", isText),
	})
}

// Failed answers 400 with what's wrong, as the Node server's validator does, when anything is
func (v *validation) Failed(w http.ResponseWriter) bool {
	if len(v.issues) == 0 {
		return false
	}
	type zodError struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	writeJSON(w, http.StatusBadRequest, struct {
		Success bool     `json:"success"`
		Error   zodError `json:"error"`
	}{Error: zodError{Name: "ZodError", Message: string(marshal(v.issues, "  "))}})
	return true
}

func itoa(n int) string {
	return string(marshal(n, ""))
}

// field is a value from a form or a query: its first value, and whether it's there at all
func field(values url.Values, name string) (any, bool) {
	if found, ok := values[name]; ok && len(found) > 0 {
		return found[0], true
	}
	return nil, false
}

// How large a request's body may be, by what it carries. Games are streamed to disk and have no limit
const (
	// Short fields only: names, passwords, a game's details
	textBodyLimit = 64 << 10
	jsonBodyLimit = 1 << 20
	// A game's box art or screenshot
	imageBodyLimit = 100 << 20
	// A save state, an in-game save or a BIOS file
	fileBodyLimit = 512 << 20
	// How much of a form's files is held in memory before the rest waits on disk
	formMemory = 1 << 20
	// The same for a save: most are a few MiB and are written straight to storage, not to the temporary folder first
	saveFormMemory = 32 << 20
)

// parseForm reads a multipart or URL-encoded form of at most limit bytes, answering 413 for a larger one, 400 for one
// that can't be read, and false
func parseForm(w http.ResponseWriter, r *http.Request, limit int64) bool {
	return parseFormHolding(w, r, limit, formMemory)
}

// parseFormHolding is parseForm holding up to memory bytes of the form's files in memory; any more waits on disk, in
// the temporary folder, until it's read
func parseFormHolding(w http.ResponseWriter, r *http.Request, limit, memory int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := r.ParseMultipartForm(memory); err != nil && !errors.Is(err, http.ErrNotMultipart) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeMessage(w, http.StatusRequestEntityTooLarge, "Request body too large")
			return false
		}
		writeMessage(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

// formFile is an uploaded file in the form, or nil
func formFile(r *http.Request, name string) *multipart.FileHeader {
	if r.MultipartForm == nil || len(r.MultipartForm.File[name]) == 0 {
		return nil
	}
	return r.MultipartForm.File[name][0]
}

// readJSON reads a JSON body with its numbers kept as written. One that isn't JSON is answered 400 as the Node server
// answers it, and false
func readJSON(w http.ResponseWriter, r *http.Request) (any, bool) {
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, jsonBodyLimit))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeMessage(w, http.StatusRequestEntityTooLarge, "Request body too large")
		return nil, false
	}
	if err == nil {
		var value any
		if value, err = decodeJSON(content); err == nil {
			return value, true
		}
	}
	writeMessage(w, http.StatusBadRequest, "Malformed JSON in request body")
	return nil, false
}
