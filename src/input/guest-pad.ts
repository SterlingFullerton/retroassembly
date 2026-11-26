import { padButtonCount } from '../emulator/play-together.ts'
import type { RetroPadButton } from './retropad.ts'

// A guest's controller, as it's sent to the host of a game played together. The guest may play with keys, a
// controller of their own or the on-screen controls, or several at once; what's sent is one standard gamepad with
// every button any of them holds.
//
// The host's emulator reads it the way it reads any second controller, by the standard layout below. The host's own
// changes to buttons and keys are theirs alone, so a guest's controller always plays the standard way

/** Where each of the emulator's buttons is on a standard gamepad */
export const standardButton: Record<RetroPadButton, number> = {
  a: 1,
  b: 0,
  down: 13,
  l: 4,
  l2: 6,
  l3: 10,
  left: 14,
  r: 5,
  r2: 7,
  r3: 11,
  right: 15,
  select: 8,
  start: 9,
  up: 12,
  x: 3,
  y: 2,
}

// The names the app's settings call the shoulder buttons by
const settingNames: Record<string, RetroPadButton> = { l1: 'l', r1: 'r' }
const keySettingPrefix = 'input_player1_'

/** The button each key plays, from the keyboard settings: only the game's buttons, not the sticks or the app's own keys */
export function getKeyButtons(keyboard: Record<string, string>) {
  const keys = new Map<string, RetroPadButton>()
  for (const [setting, key] of Object.entries(keyboard)) {
    if (key && setting.startsWith(keySettingPrefix)) {
      const name = setting.slice(keySettingPrefix.length)
      const button = settingNames[name] ?? name
      if (button in standardButton) {
        keys.set(key, button)
      }
    }
  }
  return keys
}

export interface PadSource {
  axes?: readonly number[]
  buttons?: readonly { pressed: boolean }[]
}

// A stick this near its middle is at rest: one let go of doesn't quite return to 0
const atRest = 0.1

/**
 * One controller from everything the guest is playing with: a button is held if any source holds it, and each stick
 * axis is the first source's that's pushed away from rest
 */
export function mergePads(held: Iterable<RetroPadButton>, sources: readonly (PadSource | null | undefined)[]) {
  const buttons = Array.from({ length: padButtonCount }, () => ({ pressed: false }))
  for (const button of held) {
    buttons[standardButton[button]].pressed = true
  }
  const axes = [0, 0, 0, 0]
  for (const source of sources) {
    for (let index = 0; index < padButtonCount; index += 1) {
      if (source?.buttons?.[index]?.pressed) {
        buttons[index].pressed = true
      }
    }
    for (let index = 0; index < axes.length; index += 1) {
      const value = source?.axes?.[index] ?? 0
      if (axes[index] === 0 && Math.abs(value) > atRest) {
        axes[index] = value
      }
    }
  }
  return { axes, buttons }
}
