package main

import "testing"

// The bytes tests/unit/play-together.test.ts pins the browser to sending for a controller with a stylus: buttons 0, 9
// and 16 held, the sticks at 1, -1, 0.5 and 0, and the stylus down a quarter of the way across and at the bottom
var golden = []byte{1, 2, 1, 127, 129, 64, 0, 0, 64, 255, 255, 1}

func TestPadWithStylus(t *testing.T) {
	var p pad
	p.set(golden)
	// Button 0 is RetroPad B and button 9 is Start; 16, the browser's home button, has no RetroPad button
	if p.buttons != 1<<0|1<<3 {
		t.Fatalf("buttons %b", p.buttons)
	}
	if p.axes != [4]int16{32767, -32767, 16513, 0} {
		t.Fatalf("axes %v", p.axes)
	}
	if p.pointerX != -16383 || p.pointerY != 32767 || !p.pointerDown {
		t.Fatalf("stylus at %d, %d, down %v", p.pointerX, p.pointerY, p.pointerDown)
	}

	// Without the stylus, it's let go, once a frame has seen it pressed
	p.seen()
	p.set(golden[:padStateSize])
	if p.pointerDown || p.buttons != 1<<0|1<<3 {
		t.Fatalf("without the stylus: buttons %b, down %v", p.buttons, p.pointerDown)
	}
	// Any other length isn't a controller, and changes nothing
	p.set(golden[:padStateSize+1])
	if p.buttons != 1<<0|1<<3 {
		t.Fatalf("a wrong length changed the buttons to %b", p.buttons)
	}
}
