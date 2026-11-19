package web

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
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

// File checks a field is an uploaded file
func (v *validation) File(name string, file *multipart.FileHeader) {
	if file == nil {
		v.issues = append(v.issues, fileIssue{
			Code: "invalid_type", Expected: "File", Path: []string{name},
			Message: "Invalid input: expected File, received undefined",
		})
	}
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

// parseForm reads a multipart or URL-encoded form, answering 400 and false when it can't
func parseForm(w http.ResponseWriter, r *http.Request) bool {
	if err := r.ParseMultipartForm(32 << 20); err != nil && !errors.Is(err, http.ErrNotMultipart) {
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
	content, err := io.ReadAll(r.Body)
	if err == nil {
		var value any
		if value, err = decodeJSON(content); err == nil {
			return value, true
		}
	}
	writeMessage(w, http.StatusBadRequest, "Malformed JSON in request body")
	return nil, false
}
