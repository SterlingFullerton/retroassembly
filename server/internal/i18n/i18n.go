// Package i18n is the server's own messages in the user's language, and dates typed in it, as
// src/utils/isomorphic/i18n.ts and src/middlewares/globals.ts have them.
package i18n

import (
	"fmt"
	"html"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"retroassembly/server/internal/shared"
)

type Languages struct {
	codes       []string
	dateFormats map[string]string
	fallback    string
	messages    map[string]map[string]string
}

func New(data shared.Data) *Languages {
	l := &Languages{dateFormats: data.DateFormats, fallback: data.DefaultLanguage, messages: map[string]map[string]string{}}
	for _, language := range data.Languages {
		l.codes = append(l.codes, language.Code)
		l.messages[language.Code] = language.Messages
	}
	return l
}

type accepted struct {
	language string
	q        float64
}

// quality reads a q parameter as Hono does: missing or unreadable is 1, and it's kept between 0 and 1
func quality(value string, present bool) float64 {
	if !present || value == "" {
		return 1
	}
	if value == "NaN" {
		return 0
	}
	q, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	switch {
	case err != nil:
		return 1
	case q < 0:
		return 0
	case q > 1:
		return 1
	}
	return q
}

// Detect is the language a browser asks for in its Accept-Language header, as Hono's accepts helper picks it: the most
// wanted one the app has, or the default
func (l *Languages) Detect(header string) string {
	var wanted []accepted
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(part, ";")
		language := strings.TrimSpace(fields[0])
		if language == "" {
			continue
		}
		q, present := "", false
		for _, parameter := range fields[1:] {
			key, value, found := strings.Cut(parameter, "=")
			if key = strings.TrimSpace(key); found && (key == "q" || key == "Q") {
				q, present = strings.Trim(strings.TrimSpace(value), `"`), true
			}
		}
		wanted = append(wanted, accepted{language: language, q: quality(q, present)})
	}
	// Most wanted first; "*" is the least specific, and matches nothing on its own
	slices.SortStableFunc(wanted, func(a, b accepted) int {
		if a.q != b.q {
			if b.q > a.q {
				return 1
			}
			return -1
		}
		specificity := func(language string) int {
			if language == "*" {
				return 1
			}
			return 3
		}
		return specificity(b.language) - specificity(a.language)
	})
	for _, accept := range wanted {
		if accept.q <= 0 || accept.language == "*" {
			continue
		}
		for _, code := range l.codes {
			if strings.EqualFold(accept.language, code) {
				return code
			}
		}
	}
	return l.fallback
}

// Supports tells whether a language is one of the app's
func (l *Languages) Supports(code string) bool {
	return slices.Contains(l.codes, code)
}

var placeholder = regexp.MustCompile(`\{\{\s*([^}\s]+)\s*\}\}`)

// T is a message in a language, in English when that language doesn't have it, with its {{placeholders}} filled in and
// escaped, as i18next does
func (l *Languages) T(language, key string, values map[string]any) string {
	message, ok := l.messages[language][key]
	if !ok {
		if message, ok = l.messages[l.fallback][key]; !ok {
			return key
		}
	}
	return placeholder.ReplaceAllStringFunc(message, func(match string) string {
		name := placeholder.FindStringSubmatch(match)[1]
		value, ok := values[name]
		if !ok {
			return match
		}
		return html.EscapeString(fmt.Sprint(value))
	})
}

// DateFormat is the date format a language writes dates in
func (l *Languages) DateFormat(language string) string {
	return l.dateFormats[language]
}

var dateToken = regexp.MustCompile(`yyyy|MM|dd`)

// ParseDate reads a date as Luxon's DateTime.fromFormat reads it in UTC, for the formats the app has (dd, MM and yyyy,
// in any order, with any separators): exactly two digits for the day and month, four for the year, and a real date
func ParseDate(text, format string) (time.Time, bool) {
	var fields []string
	pattern := "^" + dateToken.ReplaceAllStringFunc(regexp.QuoteMeta(format), func(token string) string {
		fields = append(fields, token)
		if token == "yyyy" {
			return `(\d{4})`
		}
		return `(\d{2})`
	}) + "$"
	if len(fields) != 3 || strings.ContainsAny(dateToken.ReplaceAllString(format, ""), "dMyHhmsSaEL") {
		return time.Time{}, false
	}
	match := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if match == nil {
		return time.Time{}, false
	}
	parts := map[string]int{}
	for i, token := range fields {
		parts[token], _ = strconv.Atoi(match[i+1])
	}
	year, month, day := parts["yyyy"], parts["MM"], parts["dd"]
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if date.Year() != year || int(date.Month()) != month || date.Day() != day {
		return time.Time{}, false
	}
	return date, true
}
