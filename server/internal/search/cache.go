package search

import "sync"

// What's kept of the names searched: enough for every name in a large library, and emptied when full rather than ever
// growing past it
const cacheLimit = 200_000

// cache keeps what a pure function made of a text, so it's made once however many searches need it
type cache[T any] struct {
	mutex  sync.RWMutex
	values map[string]T
}

func (c *cache[T]) get(text string, make func(string) T) T {
	c.mutex.RLock()
	value, found := c.values[text]
	c.mutex.RUnlock()
	if found {
		return value
	}
	value = make(text)
	c.mutex.Lock()
	if c.values == nil || len(c.values) >= cacheLimit {
		c.values = map[string]T{}
	}
	c.values[text] = value
	c.mutex.Unlock()
	return value
}

var (
	preparedNames cache[*prepared]
	titles        cache[string]
)
