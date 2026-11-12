import type { Nostalgist } from 'nostalgist'

// The on-screen controls appear to the emulator as a gamepad, so they can tilt its analog sticks by any amount: a key
// press can only push a stick all the way. Only the emulator sees this gamepad. It's added to the gamepads the emulator
// reads each frame, not to navigator.getGamepads(), so the rest of the page doesn't take it for a real controller.
const buttonCount = 17
const virtualGamepad = {
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, touched: false, value: 0 })),
  connected: true,
  id: 'RetroAssembly on-screen controls',
  index: 0,
  mapping: 'standard',
  timestamp: 0,
}

/** Left stick: axes 0 (x) and 1 (y). Right stick: axes 2 (x) and 3 (y). Down and right are positive. */
export function setVirtualGamepadAxis(axis: number, value: number) {
  virtualGamepad.axes[axis] = Math.max(-1, Math.min(1, value))
}

/** Buttons by their standard gamepad index: 10 and 11 are the stick clicks, 12 to 15 the d-pad's up, down, left, right */
export function setVirtualGamepadButton(index: number, pressed: boolean) {
  virtualGamepad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 }
}

function withVirtualGamepad(gamepads: (Gamepad | null)[] | null | undefined) {
  const list: unknown[] = gamepads ? [...gamepads] : []
  // A real controller in the first slot is the one being played with; the on-screen controls are hidden then
  if (list[0]) {
    return list
  }
  virtualGamepad.timestamp = performance.now()
  list[0] = virtualGamepad
  return list
}

/** Connects the on-screen controls to a running emulator as a gamepad */
export function attachVirtualGamepad(emulator: Nostalgist) {
  const { JSEvents } = emulator.getEmscripten() as { JSEvents?: Record<string, unknown> }
  if (!JSEvents) {
    return
  }
  virtualGamepad.axes.fill(0)
  for (const index of virtualGamepad.buttons.keys()) {
    setVirtualGamepadButton(index, false)
  }
  // Each frame the emulator stores what navigator.getGamepads() returns here, then reads its gamepads from it
  let gamepads: unknown
  Object.defineProperty(JSEvents, 'lastGamepadState', {
    configurable: true,
    get: () => gamepads,
    set: (value) => {
      gamepads = withVirtualGamepad(value)
    },
  })
  // The emulator only starts reading a gamepad once it's told one is connected. A real GamepadEvent can't carry an
  // object that isn't a real gamepad, so a plain event with the same shape is sent; the emulator only reads its gamepad
  const event = new Event('gamepadconnected')
  Object.defineProperty(event, 'gamepad', { value: virtualGamepad })
  globalThis.dispatchEvent(event)
}
