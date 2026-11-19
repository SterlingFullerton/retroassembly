package web

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"retroassembly/server/internal/auth"
)

// marshal writes JSON as JavaScript's JSON.stringify does: <, > and & as they are, and no trailing newline
func marshal(value any, indent string) []byte {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if indent != "" {
		encoder.SetIndent("", indent)
	}
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		w.Write(marshal(value, ""))
	}
}

func writeMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

// writeError answers an error as the Node server's onError does: its own status and message for a known failure, 500
// for anything else
func writeError(w http.ResponseWriter, err error) {
	var known *auth.Error
	if errors.As(err, &known) {
		writeMessage(w, known.Status, known.Message)
		return
	}
	log.Println(err)
	message := err.Error()
	if message == "" {
		message = "Unknown error"
	}
	writeMessage(w, http.StatusInternalServerError, message)
}

type zodIssue struct {
	Expected string   `json:"expected"`
	Code     string   `json:"code"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

// form reads the named fields of a multipart or URL-encoded form. A field that's missing is answered with 400 and the
// same error zod gives the Node server, and false
func form(w http.ResponseWriter, r *http.Request, names ...string) (map[string]string, bool) {
	if err := r.ParseMultipartForm(32 << 20); err != nil && !errors.Is(err, http.ErrNotMultipart) {
		writeMessage(w, http.StatusBadRequest, err.Error())
		return nil, false
	}
	values := map[string]string{}
	var issues []zodIssue
	for _, name := range names {
		if field, ok := r.PostForm[name]; ok && len(field) > 0 {
			values[name] = field[0]
			continue
		}
		issues = append(issues, zodIssue{
			Expected: "string",
			Code:     "invalid_type",
			Path:     []string{name},
			Message:  "Invalid input: expected string, received undefined",
		})
	}
	if len(issues) > 0 {
		type zodError struct {
			Name    string `json:"name"`
			Message string `json:"message"`
		}
		writeJSON(w, http.StatusBadRequest, struct {
			Success bool     `json:"success"`
			Error   zodError `json:"error"`
		}{Error: zodError{Name: "ZodError", Message: string(marshal(issues, "  "))}})
		return nil, false
	}
	return values, true
}

// redirect answers with a 302 and no body, as the Node server does
func redirect(w http.ResponseWriter, location string) {
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusFound)
}
