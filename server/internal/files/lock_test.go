package files

import (
	"testing"
	"time"
)

// One content's lock is held by one at a time, an ISO's and its CSO's are the same, and others don't wait on it
func TestLock(t *testing.T) {
	unlock := Lock("roms/psp/abc.iso")
	took := make(chan struct{})
	go func() {
		Lock("roms/psp/abc.cso")()
		close(took)
	}()
	Lock("roms/psp/other.iso")()
	select {
	case <-took:
		t.Fatal("the CSO's lock was taken while the ISO's was held")
	case <-time.After(50 * time.Millisecond):
	}
	unlock()
	<-took
	if len(locks) != 0 {
		t.Fatalf("locks left: %v", locks)
	}
}
