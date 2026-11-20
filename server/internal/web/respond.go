package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"retroassembly/server/internal/failure"
	"retroassembly/server/internal/library"
	"retroassembly/server/internal/preference"
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

// writeJSON answers with value as JSON; nil is written as null
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(marshal(value, ""))
}

func writeMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

// writeError answers an error as the Node server's onError does: its own status and message for a known failure, 500
// for anything else
func writeError(w http.ResponseWriter, err error) {
	var known *failure.Error
	if errors.As(err, &known) {
		writeMessage(w, known.Status, known.Message)
		return
	}
	// A request the browser stopped waiting for gets no answer anyway
	if !errors.Is(err, context.Canceled) {
		log.Println(err)
	}
	message := err.Error()
	if message == "" {
		message = "Unknown error"
	}
	writeMessage(w, http.StatusInternalServerError, message)
}

// form reads the named string fields of a multipart or URL-encoded form, in the order the schema lists them. A field
// that's missing is answered with 400 and the same error zod gives the Node server, and false
func form(w http.ResponseWriter, r *http.Request, names ...string) (map[string]string, bool) {
	if !parseForm(w, r, textBodyLimit) {
		return nil, false
	}
	values := map[string]string{}
	var check validation
	for _, name := range names {
		value, present := field(r.PostForm, name)
		values[name] = check.String(name, value, present, 0)
	}
	if check.Failed(w) {
		return nil, false
	}
	return values, true
}

func decodeJSON(content []byte) (any, error) {
	return preference.Decode(content)
}

// obj is a JSON object with its keys in the order given: obj("a", 1, "b", 2) is {"a":1,"b":2}
func obj(pairs ...any) library.Object {
	object := make(library.Object, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		object = append(object, library.Field{Key: pairs[i].(string), Value: pairs[i+1]})
	}
	return object
}

// redirect answers with a 302 and no body, as the Node server does
func redirect(w http.ResponseWriter, location string) {
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusFound)
}
