import { type Pad, type PadButton, type PadCluster, type PadGroup, pads } from '../consoles/pads.ts'
import type { ResolvedConsole } from '../consoles/registry.ts'
import { keyName, keypadKeyNames } from './hints.ts'
import { getColecoVisionKeyboard, getConsoleKeyboardConfig } from './keyboard.ts'
import { keySetting, type RetroPadInput, toRetroarchInputNames } from './retropad.ts'

type KeyboardMapping = Record<string, string>

/** A button of the console's controller and the key that plays it, named as on a keyboard */
export interface PadKey {
  color?: string
  key: string
  label: string
}

/** Four directions and their keys; one without a key is an empty string */
export interface PadDirections {
  color?: string
  down: string
  label: string
  left: string
  right: string
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

const directionInputs: Record<PadCluster['source'], Record<'down' | 'left' | 'right' | 'up', RetroPadInput>> = {
  dpad: { down: 'down', left: 'left', right: 'right', up: 'up' },
  'left-stick': { down: 'l_y_plus', left: 'l_x_minus', right: 'l_x_plus', up: 'l_y_minus' },
  'right-stick': { down: 'r_y_plus', left: 'r_x_minus', right: 'r_x_plus', up: 'r_y_minus' },
}

// Whether any of the four directions has a key
function played({ down, left, right, up }: PadDirections) {
  return Boolean(down || left || right || up)
}

/**
 * The console's controller with the key each button is played with: the keyboard mapping shared by every console, with
 * the keys the console moves or adds (see getConsoleKeyboardConfig). Buttons and directions without a key are left out.
 */
export function getPadKeys(
  console: Pick<ResolvedConsole, 'coin' | 'controller' | 'controls' | 'keyboard'>,
  mapping: KeyboardMapping,
): PadKeys {
  const pad: Pad = pads[console.controls] ?? pads.generic
  // The keys as RetroArch is given them, where the shoulders are l and r
  const settings: Record<string, unknown> = {
    ...toRetroarchInputNames(mapping),
    ...getConsoleKeyboardConfig(console, mapping),
  }
  function keyOf(input: RetroPadInput) {
    const key = settings[keySetting(input)]
    return typeof key === 'string' && key ? keyName(key) : ''
  }

  function keys(buttons: PadButton[] = []): PadKey[] {
    return buttons
      .map(({ color, label, retropad }) => {
        // Where Select inserts a coin, that's what it's called
        const name = console.coin && retropad === 'select' ? 'Coin' : label
        return { ...(color ? { color } : {}), key: keyOf(retropad), label: name }
      })
      .filter(({ key }) => key)
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
    return {
      ...(color ? { color } : {}),
      down: keyOf(inputs.down),
      label,
      left: keyOf(inputs.left),
      right: keyOf(inputs.right),
      up: keyOf(inputs.up),
    }
  }

  // A cabinet's Coin is Select, which its pad doesn't list
  const center = keys(
    console.coin && !pad.center?.some(({ retropad }) => retropad === 'select')
      ? [{ label: 'Coin', retropad: 'select' }, ...(pad.center ?? [])]
      : pad.center,
  )
  const rightCluster = pad.rightCluster ? directions(pad.rightCluster) : undefined
  const keypad = pad.keypad ? keypadKeyNames(getColecoVisionKeyboard(mapping).keys.keypad) : ''
  return {
    center,
    face: rows(pad.face),
    ...(keypad ? { keypad } : {}),
    leftGroup: group(pad.leftGroup),
    moves: pad.moves.map((cluster) => directions(cluster)).filter((cluster) => played(cluster)),
    rightCluster: rightCluster && played(rightCluster) ? rightCluster : undefined,
    rightGroup: group(pad.rightGroup),
    shoulders: { left: keys(pad.shoulders?.left), right: keys(pad.shoulders?.right) },
  }
}
