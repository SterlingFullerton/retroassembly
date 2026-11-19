package web

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// The headers Go's isolation middleware already set, which the Node server's answer would otherwise repeat
var isolationHeaders = []string{"Cross-Origin-Embedder-Policy", "Cross-Origin-Opener-Policy"}

// nodeProxy passes what the Go server doesn't answer yet to the Node server, so the API can move over a group at a
// time. The Node server sees the address the browser asked for, as a proxy in front of it would tell it
func nodeProxy(node *url.URL) http.Handler {
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			// Kept as they came when the app is itself behind a proxy that set them
			forwardedHost := r.In.Header.Get("X-Forwarded-Host")
			forwardedProto := r.In.Header.Get("X-Forwarded-Proto")
			r.SetURL(node)
			r.SetXForwarded()
			if forwardedHost != "" {
				r.Out.Header.Set("X-Forwarded-Host", forwardedHost)
			}
			if forwardedProto != "" {
				r.Out.Header.Set("X-Forwarded-Proto", forwardedProto)
			}
		},
		ModifyResponse: func(response *http.Response) error {
			for _, name := range isolationHeaders {
				response.Header.Del(name)
			}
			return nil
		},
		// Streams answers as they come, such as a game being downloaded
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			// The browser stopped waiting, such as for a page it left before it loaded: nothing to answer or report
			if errors.Is(err, context.Canceled) {
				return
			}
			log.Printf("passing %s %s to the Node server: %v", r.Method, r.URL.Path, err)
			w.WriteHeader(http.StatusBadGateway)
		},
	}
}
