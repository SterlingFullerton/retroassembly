package files

import (
	"path"
	"strings"
	"sync"
)

// A stored game or BIOS file is shared by everyone who added the same content, so adding it ("is it there? then it
// needn't be written") and removing it ("is it still used? then delete it") are each done under its lock: otherwise a
// file one user's upload was about to rely on could be deleted by another user's delete in between
var (
	locksMutex sync.Mutex
	locks      = map[string]*contentLock{}
)

type contentLock struct {
	mutex sync.Mutex
	users int
}

// lockKey is a file id without its extension: a PSP disc's ISO and CSO are the same content, and share a lock
func lockKey(id string) string {
	return strings.TrimSuffix(id, path.Ext(id))
}

// Lock takes the lock of a stored file's content, and is the function that gives it back
func Lock(id string) func() {
	key := lockKey(id)
	locksMutex.Lock()
	held := locks[key]
	if held == nil {
		held = &contentLock{}
		locks[key] = held
	}
	held.users++
	locksMutex.Unlock()

	held.mutex.Lock()
	return func() {
		held.mutex.Unlock()
		locksMutex.Lock()
		if held.users--; held.users == 0 {
			delete(locks, key)
		}
		locksMutex.Unlock()
	}
}
