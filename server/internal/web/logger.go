package web

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
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

// clientAddress is the address of the computer a request came from: the connection's, or, through a trusted reverse
// proxy, the one the proxy says it came from (see forwardedClient)
func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// forwardedClient takes a request that came through one of the trusted reverse proxies to come from the address the
// proxies say. X-Forwarded-For lists each step a request was passed along, and each proxy adds the one it came from
// to the end, so it's read from the end: the last address that isn't another trusted proxy is the client's. What comes
// before that is whatever the client wrote, and is never believed. From anywhere else, the header is ignored
func forwardedClient(proxies []netip.Prefix, next http.Handler) http.Handler {
	trusted := func(address netip.Addr) bool {
		for _, prefix := range proxies {
			if prefix.Contains(address.Unmap()) {
				return true
			}
		}
		return false
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, err := netip.ParseAddr(clientAddress(r))
		if err != nil || !trusted(peer) {
			next.ServeHTTP(w, r)
			return
		}
		var steps []string
		for _, header := range r.Header.Values("X-Forwarded-For") {
			steps = append(steps, strings.Split(header, ",")...)
		}
		if len(steps) == 0 {
			steps = []string{r.Header.Get("X-Real-IP")}
		}
		for index := len(steps) - 1; index >= 0; index-- {
			address, err := netip.ParseAddr(strings.TrimSpace(steps[index]))
			if err != nil {
				// Not an address: nothing before it can be told apart from what the client wrote
				break
			}
			if !trusted(address) || index == 0 {
				r.RemoteAddr = net.JoinHostPort(address.Unmap().String(), "0")
				break
			}
		}
		next.ServeHTTP(w, r)
	})
}

// logger writes a line for each request in the Combined Log Format, with the signed-in user's id, as
// src/middlewares/logger.ts does: to standard output when it went well, standard error otherwise
func logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record := &recorder{ResponseWriter: w}
		next.ServeHTTP(record, r)

		// Only an address: a header the client wrote could otherwise put anything at the start of the line
		remoteAddress := clientAddress(r)
		if _, err := netip.ParseAddr(remoteAddress); err != nil {
			remoteAddress = "-"
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
