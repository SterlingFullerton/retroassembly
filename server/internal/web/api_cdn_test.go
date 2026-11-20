package web

import "testing"

// A fragment, which browsers never send, is refused before anything is fetched: each "#..." would otherwise be a file
// of its own, downloaded and kept again, by anyone, signed in or not
func TestCDNCachePath(t *testing.T) {
	for _, test := range []struct {
		uri, want string
		ok        bool
	}{
		{"/cdn/jsdelivr/gh/a/b@1/c.png", "jsdelivr/gh/a/b@1/c.png", true},
		{"/cdn/jsdelivr/gh/a/b@1/c.png?v=2", "jsdelivr/gh/a/b@1/c.png", true},
		{"/cdn/jsdelivr/gh/a/b@1/c.png#1", "", false},
		{"/cdn/jsdelivr/gh/a/b@1/c.png?v=2#1", "jsdelivr/gh/a/b@1/c.png", true},
	} {
		if got, ok := cdnCachePath(test.uri); got != test.want || ok != test.ok {
			t.Errorf("%s: %q %v", test.uri, got, ok)
		}
	}
}
