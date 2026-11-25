import { type Pad, type PadButton, type PadCluster, type PadGroup, pads } from '../consoles/pads.ts'
import type { ResolvedConsole } from '../consoles/registry.ts'
import {
  buttonSetting,
  type ConsoleButtons,
  gamepadButtonName,
  getConsoleButtons,
  getDefaultConsoleButtons,
} from './console-buttons.ts'
import { type ConsoleKeys, getConsoleKeys, getDefaultConsoleKeys } from './console-keys.ts'
import { keyName, keypadKeyNames } from './hints.ts'
import { getColecoVisionKeyboard } from './keyboard.ts'
import { keySetting, type RetroPadButton, type RetroPadInput } from './retropad.ts'

type KeyboardMapping = Record<string, string>

/** A button of the console's controller and the key that plays it, named as on a keyboard */
export interface PadKey {
  /** The player gave it this key for this console; only said for the settings */
  changed?: boolean
  color?: string
  /** A picture in place of the key's name: a gamepad button drawn by where it sits */
  icon?: string
  /** What the emulator reads it from; only said for the settings */
  input?: RetroPadInput
  key: string
  label: string
}

type Direction = 'down' | 'left' | 'right' | 'up'

/** Four directions and their keys; one without a key is an empty string */
export interface PadDirections {
  /** The directions the player gave keys of their own for this console; only said for the settings */
  changed?: Direction[]
  color?: string
  down: string
  /** What the emulator reads each direction from; only said for the settings */
  inputs?: Record<Direction, RetroPadInput>
  label: string
  left: string
  right: string
  /** On a gamepad, the stick the four directions are read from, which isn't set here: 'L' or 'R' */
  stick?: 'L' | 'R'
  up: string
}

export interface PadKeyGroup {
  label?: string
  rows: PadKey[][]
}

/** A console's controller with the keys that play it: what the pause menu draws for a keyboard */
export interface PadKeys {
  center: PadKey[]
  face: PadKey[][]
  /** The keys of the console's keypad, as one range when they're the number keys */
  keypad?: string
  leftGroup?: PadKeyGroup
  moves: PadDirections[]
  rightCluster?: PadDirections
  rightGroup?: PadKeyGroup
  shoulders: { left: PadKey[]; right: PadKey[] }
}

const directionInputs: Record<PadCluster['source'], Record<Direction, RetroPadInput>> = {
  dpad: { down: 'down', left: 'left', right: 'right', up: 'up' },
  'left-stick': { down: 'l_y_plus', left: 'l_x_minus', right: 'l_x_plus', up: 'l_y_minus' },
  'right-stick': { down: 'r_y_plus', left: 'r_x_minus', right: 'r_x_plus', up: 'r_y_minus' },
}

// Whether any of the four directions has a key, or they're a gamepad's stick
function played({ down, left, right, stick, up }: PadDirections) {
  return Boolean(down || left || right || up || stick)
}

type PadConsole = Pick<ResolvedConsole, 'coin' | 'controller' | 'controls' | 'keyboard'>

/** How one of the controller's inputs is played, for the picture */
interface Played {
  changed: boolean
  icon?: string
  key: string
}

interface PadLayoutOptions {
  /** For the settings: every button, what each is read from and which are the player's own */
  edit: boolean
  /** The console's keypad's keys, when it has one */
  keypad?: string
  /** How an input is played */
  played: (input: RetroPadInput) => Played
  /** On a gamepad the sticks are the gamepad's own, not four buttons */
  sticks?: boolean
}

// The console's controller laid out with whatever plays each button: keys or a gamepad's buttons
function layoutPad(
  console: PadConsole,
  { edit, keypad, played: playedWith, sticks = false }: PadLayoutOptions,
): PadKeys {
  const pad: Pad = pads[console.controls] ?? pads.generic

  function keys(buttons: PadButton[] = []): PadKey[] {
    return buttons
      .map(({ color, label, retropad }) => {
        // Where Select inserts a coin, that's what it's called
        const name = console.coin && retropad === 'select' ? 'Coin' : label
        const { changed, icon, key } = playedWith(retropad)
        return {
          ...(color ? { color } : {}),
          ...(edit ? { changed, input: retropad } : {}),
          ...(icon ? { icon } : {}),
          key,
          label: name,
        }
      })
      .filter(({ icon, key }) => edit || key || icon)
  }
  function rows(buttonRows: PadButton[][]) {
    return buttonRows.map((row) => keys(row)).filter((row) => row.length > 0)
  }
  function group(padGroup?: PadGroup): PadKeyGroup | undefined {
    const groupRows = padGroup ? rows(padGroup.rows) : []
    return padGroup && groupRows.length > 0 ? { label: padGroup.label, rows: groupRows } : undefined
  }
  function directions({ color, label, source }: PadCluster): PadDirections {
    const inputs = directionInputs[source]
    if (sticks && source !== 'dpad') {
      return {
        ...(color ? { color } : {}),
        down: '',
        label,
        left: '',
        right: '',
        stick: source === 'left-stick' ? 'L' : 'R',
        up: '',
      }
    }
    const ways = Object.keys(inputs) as Direction[]
    return {
      ...(color ? { color } : {}),
      ...(edit ? { changed: ways.filter((way) => playedWith(inputs[way]).changed), inputs } : {}),
      down: playedWith(inputs.down).key,
      label,
      left: playedWith(inputs.left).key,
      right: playedWith(inputs.right).key,
      up: playedWith(inputs.up).key,
    }
  }

  // A cabinet's Coin is Select, which its pad doesn't list
  const center = keys(
    console.coin && !pad.center?.some(({ retropad }) => retropad === 'select')
      ? [{ label: 'Coin', retropad: 'select' }, ...(pad.center ?? [])]
      : pad.center,
  )
  const rightCluster = pad.rightCluster ? directions(pad.rightCluster) : undefined
  return {
    center,
    face: rows(pad.face),
    ...(keypad ? { keypad } : {}),
    leftGroup: group(pad.leftGroup),
    moves: pad.moves.map((cluster) => directions(cluster)).filter((cluster) => edit || played(cluster)),
    rightCluster: rightCluster && (edit || played(rightCluster)) ? rightCluster : undefined,
    rightGroup: group(pad.rightGroup),
    shoulders: { left: keys(pad.shoulders?.left), right: keys(pad.shoulders?.right) },
  }
}

/**
 * The console's controller with the key each button is played with: the keyboard mapping shared by every console, with
 * the keys the console moves or adds and then the player's `own` keys for it (see getConsoleKeys). Buttons and
 * directions without a key are left out, unless it's for the settings (`edit`), which show every button, say what each
 * is read from and mark the ones on a key of the player's own.
 */
export function getPadKeys(
  console: PadConsole,
  mapping: KeyboardMapping,
  { edit = false, own }: { edit?: boolean; own?: ConsoleKeys | null } = {},
): PadKeys {
  // The keys as RetroArch is given them, where the shoulders are l and r
  const settings = getConsoleKeys(console, mapping, own)
  const defaults = getDefaultConsoleKeys(console, mapping)
  const pad: Pad = pads[console.controls] ?? pads.generic
  return layoutPad(console, {
    edit,
    keypad: pad.keypad ? keypadKeyNames(getColecoVisionKeyboard(mapping).keys.keypad) : '',
    played(input) {
      const key = settings[keySetting(input)]
      return { changed: key !== defaults[keySetting(input)], key: key ? keyName(key) : '' }
    },
  })
}

/**
 * The console's controller with the gamepad button each of its buttons is played with: the gamepad's layout with the
 * player's `own` buttons for the console over it. The sticks are the gamepad's own. `edit` as for getPadKeys
 */
export function getPadButtons(
  console: PadConsole,
  gamepad: Record<string, unknown>,
  { edit = false, own }: { edit?: boolean; own?: ConsoleButtons | null } = {},
): PadKeys {
  const settings = getConsoleButtons(gamepad, own)
  const defaults = getDefaultConsoleButtons(gamepad)
  return layoutPad(console, {
    edit,
    played(input) {
      const setting = buttonSetting(input as RetroPadButton)
      return { changed: settings[setting] !== defaults[setting], ...gamepadButtonName(settings[setting] ?? '') }
    },
    sticks: true,
  })
}
