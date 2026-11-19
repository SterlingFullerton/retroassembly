package web

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(content []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(content)
}

func (r *recorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func quote(value string) string {
	return string(marshal(value, ""))
}

func requestURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host + r.RequestURI
}

// clientAddress is the address of the computer a request came from, as the connection has it
func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// logger writes a line for each request in the Combined Log Format, with the signed-in user's id, as
// src/middlewares/logger.ts does: to standard output when it went well, standard error otherwise
func logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record := &recorder{ResponseWriter: w}
		next.ServeHTTP(record, r)
		if state := stateOf(r); state != nil && state.proxied {
			return
		}

		remoteAddress := r.Header.Get("X-Forwarded-For")
		if remoteAddress == "" {
			remoteAddress = r.Header.Get("X-Real-IP")
		}
		if remoteAddress == "" {
			remoteAddress = clientAddress(r)
		}
		userID := "-"
		if state := stateOf(r); state != nil && state.user != nil {
			userID = state.user.ID
		}
		httpVersion := r.Header.Get("HTTP-Version")
		if httpVersion == "" {
			httpVersion = "HTTP/1.1"
		}
		status := record.status
		if status == 0 {
			status = http.StatusOK
		}
		contentLength := w.Header().Get("Content-Length")
		if contentLength == "" {
			contentLength = "-"
		}
		orDash := func(value string) string {
			if value == "" {
				return "-"
			}
			return value
		}
		line := strings.Join([]string{
			remoteAddress,
			"-",
			userID,
			"[" + time.Now().UTC().Format("2006-01-02T15:04:05.000Z") + "]",
			quote(strings.Join([]string{r.Method, requestURL(r), httpVersion}, " ")),
			fmt.Sprint(status),
			contentLength,
			quote(orDash(r.Referer())),
			quote(orDash(r.UserAgent())),
		}, " ")
		if status < 400 {
			fmt.Fprintln(os.Stdout, line)
		} else {
			fmt.Fprintln(os.Stderr, line)
		}
	})
}
