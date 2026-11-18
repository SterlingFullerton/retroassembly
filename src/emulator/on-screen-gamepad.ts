import type { Nostalgist } from 'nostalgist'
import { attachGamepad, type EmulatorGamepad } from './adapter.ts'

// The on-screen controls appear to the emulator as a gamepad, so they can tilt its analog sticks by any amount: a key
// press can only push a stick all the way. Each game session makes its own when it starts, and lets go of it on exit;
// the controls write to the one of the session that's running

const buttonCount = 17

function createOnScreenGamepad(): EmulatorGamepad {
  return {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, touched: false, value: 0 })),
    connected: true,
    id: 'RetroAssembly on-screen controls',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
  }
}

let running: EmulatorGamepad | undefined

/** Gives a game session that's starting a fresh on-screen gamepad, and connects it to the emulator */
export function connectOnScreenGamepad(emulator: Nostalgist) {
  const gamepad = createOnScreenGamepad()
  running = gamepad
  attachGamepad(emulator, gamepad)
  return gamepad
}

/** For the test-only controls page: an on-screen gamepad with no emulator, so a test can read what the controls set */
export function connectTestOnScreenGamepad() {
  running = createOnScreenGamepad()
  return running
}

/** Lets go of a session's on-screen gamepad when it exits */
export function disconnectOnScreenGamepad(gamepad: EmulatorGamepad | undefined) {
  if (gamepad && running === gamepad) {
    running = undefined
  }
}

/** Left stick: axes 0 (x) and 1 (y). Right stick: axes 2 (x) and 3 (y). Down and right are positive. */
export function setVirtualGamepadAxis(axis: number, value: number) {
  if (running) {
    running.axes[axis] = Math.max(-1, Math.min(1, value))
  }
}

/** Buttons by their standard gamepad index: 10 and 11 are the stick clicks, 12 to 15 the d-pad's up, down, left, right */
export function setVirtualGamepadButton(index: number, pressed: boolean) {
  if (running) {
    running.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 }
  }
}
