// Package cdn is the server's cache of CDN files, as src/utils/server/cdn-cache.ts keeps it: with
// RETROASSEMBLY_RUN_TIME_CDN_CACHE=true, the browser loads jsDelivr's and libretro's files through /cdn/, and the
// server keeps a copy of each in the data folder, so the library keeps working without the internet.
package cdn

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"retroassembly/server/internal/shared"
)

const (
	CDNHost      = "https://cdn.jsdelivr.net/"
	LibretroHost = "https://thumbnails.libretro.com/"
)

// The hosts /cdn/ serves, by the name its addresses start with
var cacheHosts = map[string]string{"jsdelivr": CDNHost, "libretro-thumbnails": LibretroHost}

// ErrURIMalformed is decodeURIComponent's URIError: an escape that isn't one, or bytes that aren't UTF-8
var ErrURIMalformed = errors.New("URI malformed")

// Data is what the cache knows from the app's TypeScript definitions
type Data struct{ shared.CDN }

func isHex(b byte) bool {
	return b >= '0' && b <= '9' || b >= 'a' && b <= 'f' || b >= 'A' && b <= 'F'
}

func unhex(b byte) byte {
	switch {
	case b >= 'a':
		return b - 'a' + 10
	case b >= 'A':
		return b - 'A' + 10
	}
	return b - '0'
}

// DecodeURIComponent is JavaScript's decodeURIComponent
func DecodeURIComponent(value string) (string, error) {
	if !strings.Contains(value, "%") {
		return value, nil
	}
	decoded := make([]byte, 0, len(value))
	for i := 0; i < len(value); i++ {
		if value[i] != '%' {
			decoded = append(decoded, value[i])
			continue
		}
		if i+2 >= len(value) || !isHex(value[i+1]) || !isHex(value[i+2]) {
			return "", ErrURIMalformed
		}
		decoded = append(decoded, unhex(value[i+1])<<4|unhex(value[i+2]))
		i += 2
	}
	if !utf8.Valid(decoded) {
		return "", ErrURIMalformed
	}
	return string(decoded), nil
}

// EncodeURIComponent is JavaScript's encodeURIComponent
func EncodeURIComponent(value string) string {
	var builder strings.Builder
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.IndexByte("-_.!~*'()", b) >= 0 {
			builder.WriteByte(b)
		} else {
			fmt.Fprintf(&builder, "%%%02X", b)
		}
	}
	return builder.String()
}

// percentEncode writes the bytes the URL standard escapes in a part of an address: the C0 controls, space, those in
// extra, and everything past ASCII
func percentEncode(value, extra string) string {
	var builder strings.Builder
	for _, b := range []byte(value) {
		if b <= ' ' || b > '~' || strings.IndexByte(extra, b) >= 0 {
			fmt.Fprintf(&builder, "%%%02X", b)
		} else {
			builder.WriteByte(b)
		}
	}
	return builder.String()
}

var scheme = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)

func isDot(segment string) bool {
	return segment == "." || strings.EqualFold(segment, "%2e")
}

func isDoubleDot(segment string) bool {
	switch strings.ToLower(segment) {
	case "..", ".%2e", "%2e.", "%2e%2e":
		return true
	}
	return false
}

// resolve is new URL(input, base).href for a relative address on base, an https origin ending in "/", as the URL
// standard reads it: tabs and line breaks dropped, backslashes as slashes, "." and ".." segments resolved, and the
// characters it escapes escaped. An address with a scheme or a host of its own isn't one, and gives false
func resolve(base, input string) (string, bool) {
	input = strings.Trim(input, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f ")
	input = strings.NewReplacer("\t", "", "\n", "", "\r", "").Replace(input)
	if scheme.MatchString(input) {
		return "", false
	}
	origin := strings.TrimSuffix(base, "/")
	if input == "" {
		return base, true
	}
	// Before the fragment only: a backslash in the fragment stays one
	hash := strings.IndexByte(input, '#')
	if hash < 0 {
		hash = len(input)
	}
	input = strings.ReplaceAll(input[:hash], `\`, "/") + input[hash:]
	if strings.HasPrefix(input, "//") {
		return "", false
	}

	rest, fragment, hasFragment := strings.Cut(input, "#")
	path, query, hasQuery := strings.Cut(rest, "?")
	var segments []string
	if path != "" || !hasQuery && !hasFragment {
		path = strings.TrimPrefix(path, "/")
		parts := strings.Split(path, "/")
		for i, part := range parts {
			last := i == len(parts)-1
			switch {
			case isDoubleDot(part):
				if len(segments) > 0 {
					segments = segments[:len(segments)-1]
				}
				if last {
					segments = append(segments, "")
				}
			case isDot(part):
				if last {
					segments = append(segments, "")
				}
			default:
				segments = append(segments, percentEncode(part, "\"#<>?`{}"))
			}
		}
	} else {
		segments = []string{""}
	}
	href := origin + "/" + strings.Join(segments, "/")
	if hasQuery {
		href += "?" + percentEncode(query, "\"#<>'")
	}
	if hasFragment {
		href += "#" + percentEncode(fragment, "\"<>`")
	}
	return href, true
}

// pathname is an address's path, as it's written in it
func pathname(href string) string {
	rest := href
	if _, after, found := strings.Cut(href, "://"); found {
		rest = after
	}
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		return "/"
	}
	rest = rest[slash:]
	if end := strings.IndexAny(rest, "?#"); end >= 0 {
		rest = rest[:end]
	}
	return rest
}

// ToCacheURL is the address of a file of one of the cached hosts under /cdn/, as toCDNCacheUrl gives it
func ToCacheURL(href string) string {
	for name, host := range cacheHosts {
		if strings.HasPrefix(href, host) {
			return "/cdn/" + name + "/" + href[len(host):]
		}
	}
	return href
}

// Target is what an address under /cdn/ stands for
type Target struct {
	// Box art and screenshots are open-ended, so only signed-in users may add them to the cache
	RequiresLogin bool
	URL           string
}

// ResolveTarget maps a path under /cdn/ back to the file it stands for, or nil for one the app doesn't load, so /cdn/
// can't be used to fetch anything else
func (d *Data) ResolveTarget(cachePath string) (*Target, error) {
	name, rest, found := strings.Cut(strings.TrimLeft(cachePath, "/"), "/")
	host := cacheHosts[name]
	if host == "" || !found {
		return nil, nil
	}
	href, ok := resolve(host, rest)
	if !ok {
		return nil, nil
	}
	if name == "libretro-thumbnails" {
		return &Target{RequiresLogin: true, URL: href}, nil
	}
	path := pathname(href)
	for _, font := range d.FontPaths {
		if font == path {
			return &Target{URL: href}, nil
		}
	}

	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if parts[0] != "gh" {
		return nil, nil
	}
	part := func(i int) string {
		if i < len(parts) {
			return parts[i]
		}
		return ""
	}
	repositoryAndVersion, err := DecodeURIComponent(part(2))
	if err != nil {
		return nil, err
	}
	pieces := strings.Split(repositoryAndVersion, "@")
	version := ""
	if len(pieces) > 1 {
		version = pieces[1]
	}
	owner, err := DecodeURIComponent(part(1))
	if err != nil {
		return nil, err
	}
	if owner == "libretro-thumbnails" {
		return &Target{RequiresLogin: true, URL: href}, nil
	}
	if pinned := d.PinnedRepositories[owner+"/"+pieces[0]]; pinned != "" && pinned == version {
		return &Target{URL: href}, nil
	}
	return nil, nil
}
