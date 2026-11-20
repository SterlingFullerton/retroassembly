package i18n

import (
	"testing"

	"retroassembly/server/internal/shared"
)

func languages(t *testing.T) *Languages {
	t.Helper()
	data, err := shared.Load()
	if err != nil {
		t.Fatal(err)
	}
	return New(data)
}

// What Hono's accepts helper picks for each, with the app's languages
func TestDetect(t *testing.T) {
	l := languages(t)
	cases := map[string]string{
		"de-DE,de;q=0.9,en;q=0.8": "de",
		"fr":                      "fr",
		"en-ca":                   "en-CA",
		"zh-TW,zh;q=0.9":          "zh-TW",
		"xx, ja;q=0.5, ko;q=0.6":  "ko",
		"*":                       "en",
		"":                        "en",
		"de;q=0, fr;q=0.1":        "fr",
		"pt;q=abc, ru;q=0.9":      "pt",
		"es;q=2, it":              "es",
		"ZH-cn":                   "zh-CN",
		"en-US,en;q=0.9":          "en",
	}
	for header, want := range cases {
		if got := l.Detect(header); got != want {
			t.Errorf("Detect(%q) = %q, Hono %q", header, got, want)
		}
	}
}

func TestT(t *testing.T) {
	l := languages(t)
	if got := l.T("de", "error.exceedMaxRomCount", map[string]any{"maxRomCount": 5}); got != "Das Hinzufügen dieser ROMs würde die maximal erlaubte ROM-Anzahl von 5 überschreiten." {
		t.Errorf("German: %q", got)
	}
	if got := l.T("en", "error.exceedMaxRomCount", map[string]any{"maxRomCount": "<5 & more>"}); got != "Adding these ROMs would exceed the maximum allowed ROM count of <5 & more>." {
		t.Errorf("a value with an ampersand: %q", got)
	}
	if got := l.T("en-CA", "nav.favorites", nil); got != "Favourites" {
		t.Errorf("Canadian English: %q", got)
	}
	if got := l.T("xx", "nav.history", nil); got != "History" {
		t.Errorf("an unknown language is English: %q", got)
	}
}

// What Luxon's DateTime.fromFormat answers for each, in UTC
func TestParseDate(t *testing.T) {
	cases := []struct {
		format, text, want string
	}{
		{"dd/MM/yyyy", "13/09/1985", "1985-09-13"},
		{"dd/MM/yyyy", "1/9/1985", ""},
		{"dd/MM/yyyy", "31/02/1985", ""},
		{"dd/MM/yyyy", "13/09/85", ""},
		{"dd/MM/yyyy", "13/09/19850", ""},
		{"MM/dd/yyyy", "09/13/1985", "1985-09-13"},
		{"yyyy-MM-dd", "1985-09-13", "1985-09-13"},
		{"yyyy-MM-dd", "0985-09-13", "0985-09-13"},
		{"dd.MM.yyyy", "13.09.1985", "1985-09-13"},
		{"yyyy/MM/dd", "1985/9/13", ""},
		{"dd/MM/yyyy", "13-09-1985", ""},
		{"dd/MM/yyyy", "00/09/1985", ""},
		{"yyyy-MM-dd", "+1985-09-13", ""},
		{"dd/MM/yyyy", "29/02/2000", "2000-02-29"},
		{"dd/MM/yyyy", "29/02/1900", ""},
		{"yyyy-MM-dd", "0000-01-01", "0000-01-01"},
	}
	for _, test := range cases {
		date, ok := ParseDate(test.text, test.format)
		got := ""
		if ok {
			got = date.Format("2006-01-02")
		}
		if got != test.want {
			t.Errorf("ParseDate(%q, %q) = %q, Luxon %q", test.text, test.format, got, test.want)
		}
	}
}
