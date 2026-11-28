package main

import (
	"sync/atomic"
	"testing"
)

// A stylus message: the controller at rest, the stylus in the middle, down or not
func stylusAt(down bool) []byte {
	state := make([]byte, padWithPointerSize)
	state[7], state[8], state[9], state[10] = 0xff, 0x7f, 0xff, 0x7f
	if down {
		state[11] = 1
	}
	return state
}

func TestQuickTapIsHeldUntilAFrameSeesIt(t *testing.T) {
	var p pad
	p.set(stylusAt(true))
	p.set(stylusAt(false))
	if !p.pointerDown {
		t.Fatal("a tap let go before any frame ran was lost")
	}
	p.seen()
	if p.pointerDown {
		t.Fatal("the tap was still down after a frame ran with it")
	}
}

func TestHeldStylusLetGoAtOnceOnceSeen(t *testing.T) {
	var p pad
	p.set(stylusAt(true))
	p.seen()
	p.set(stylusAt(false))
	if p.pointerDown {
		t.Fatal("a press a frame had seen was held after it was let go")
	}
}

func TestPressAgainBeforeAFrameStaysDown(t *testing.T) {
	var p pad
	p.set(stylusAt(true))
	p.set(stylusAt(false))
	p.set(stylusAt(true))
	p.seen()
	if !p.pointerDown {
		t.Fatal("a stylus pressed again was let go")
	}
}

func TestEstimateFallsWithLossAndRecovers(t *testing.T) {
	rate := kilobits
	for range 30 {
		rate = nextEstimate(rate, 0.3)
	}
	if rate != leastKilobits {
		t.Fatalf("heavy loss left the rate at %d", rate)
	}
	if mild := nextEstimate(900, 0.11); mild != 800 {
		t.Fatalf("mild loss changed 900 to %d", mild)
	}
	middle := nextEstimate(3000, 0.05)
	if middle != 3000 {
		t.Fatalf("some loss changed the rate to %d", middle)
	}
	for range 100 {
		rate = nextEstimate(rate, 0)
	}
	if rate != kilobits {
		t.Fatalf("no loss left the rate at %d", rate)
	}
}

func resetSlots() {
	slots.Lock()
	slots.taken = [4]bool{}
	slots.connected = nil
	slots.Unlock()
	players.Store(0)
}

func TestPlayerLeftAloneBecomesPlayerOne(t *testing.T) {
	resetSlots()
	var first, second atomic.Int32
	first.Store(int32(takeSlot()))
	connectSlot(&first)
	second.Store(int32(takeSlot()))
	connectSlot(&second)
	if second.Load() != 1 {
		t.Fatalf("second player is player %d", second.Load()+1)
	}
	freeSlot(&first)
	if second.Load() != 0 {
		t.Fatalf("left alone, the second player is player %d", second.Load()+1)
	}
	if players.Load() != 1 {
		t.Fatalf("%d players counted", players.Load())
	}
}

func TestPlaceHeldForAnswerIsKept(t *testing.T) {
	resetSlots()
	var first, waiting, third atomic.Int32
	first.Store(int32(takeSlot()))
	connectSlot(&first)
	// Player 2's place is held for their answer; they haven't connected
	waiting.Store(int32(takeSlot()))
	third.Store(int32(takeSlot()))
	connectSlot(&third)
	freeSlot(&first)
	if waiting.Load() != 1 || third.Load() != 0 {
		t.Fatalf("waiting player %d, third player %d", waiting.Load()+1, third.Load()+1)
	}
}
