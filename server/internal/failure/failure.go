// Package failure is a failure the API answers with its own status and message, as the Node server's HTTPException
// and DomainError.
package failure

import "net/http"

type Error struct {
	Message string
	Status  int
}

func (e *Error) Error() string {
	return e.Message
}

func New(status int, message string) *Error {
	return &Error{Message: message, Status: status}
}

// The Node server's DomainError kinds, with their default messages
var (
	Forbidden    = New(http.StatusForbidden, "Forbidden")
	NotFound     = New(http.StatusNotFound, "Not found")
	Unauthorized = New(http.StatusUnauthorized, "Unauthorized")
)
