import type { ResolvedConsole } from '../consoles/registry.ts'
import { getConsoleKeyboardConfig } from './keyboard.ts'
import {
  keySetting,
  type RetroPadAxis,
  type RetroPadInput,
  retroPadButtons,
  toRetroarchInputNames,
} from './retropad.ts'

// The keys a console is played with. Every console starts from the keyboard layout shared by all of them, with the
// keys the console itself moves or adds (the N64's stick, C buttons and Z, for one). On top of those come the player's
// own keys for that console, kept as only what differs

/** A player's own keys for one console: RetroArch's setting for each input they changed and its key, '' for none */
export type ConsoleKeys = Record<string, string>

type KeyboardMapping = Record<string, string>
type KeyedConsole = Pick<ResolvedConsole, 'controller' | 'keyboard'>

const axes: RetroPadAxis[] = [
  'l_x_minus',
  'l_x_plus',
  'l_y_minus',
  'l_y_plus',
  'r_x_minus',
  'r_x_plus',
  'r_y_minus',
  'r_y_plus',
]
const inputs: RetroPadInput[] = [...retroPadButtons, ...axes]

// What the app does itself or has RetroArch do while a game runs, whichever console it is
const hotkeys = ['$pause', 'input_rewind', 'input_hold_fast_forward'] as const
export type Hotkey = (typeof hotkeys)[number]

/** The key for each of a console's inputs before the player's own: the shared layout, as the console moves it */
export function getDefaultConsoleKeys(console: KeyedConsole, shared: KeyboardMapping) {
  const settings: Record<string, unknown> = {
    ...toRetroarchInputNames(shared),
    // RetroArch's web build swaps the left stick's up and down keys (see buildInputConfig)
    input_player1_l_y_minus: shared.input_player1_l_y_plus,
    input_player1_l_y_plus: shared.input_player1_l_y_minus,
    ...getConsoleKeyboardConfig(console, shared),
  }
  const keys: ConsoleKeys = {}
  for (const input of inputs) {
    const key = settings[keySetting(input)]
    keys[keySetting(input)] = typeof key === 'string' ? key : ''
  }
  return keys
}

// Only settings for the controller's inputs, with a key or none: what's stored comes from outside
function ownKeys(own: ConsoleKeys | null | undefined) {
  const keys: ConsoleKeys = {}
  for (const input of inputs) {
    const key = own?.[keySetting(input)]
    if (typeof key === 'string') {
      keys[keySetting(input)] = key
    }
  }
  return keys
}

/** The key each of a console's inputs is played with: its defaults with the player's own keys over them */
export function getConsoleKeys(console: KeyedConsole, shared: KeyboardMapping, own?: ConsoleKeys | null) {
  return { ...getDefaultConsoleKeys(console, shared), ...ownKeys(own) }
}

/** The player's own keys as RetroArch settings, for a game's launch: only those that differ from the defaults */
export function getOwnKeySettings(console: KeyedConsole, shared: KeyboardMapping, own?: ConsoleKeys | null) {
  const defaults = getDefaultConsoleKeys(console, shared)
  return Object.fromEntries(Object.entries(ownKeys(own)).filter(([setting, key]) => defaults[setting] !== key))
}

/**
 * The player's own keys for a console after one input is given a key, or none (''). Another input on that key loses
 * it, as a key plays one thing. What comes back is only what differs from the defaults, so giving an input its default
 * key back removes it
 */
export function bindConsoleKey(
  { console, own, shared }: { console: KeyedConsole; own?: ConsoleKeys | null; shared: KeyboardMapping },
  input: RetroPadInput,
  key: string,
) {
  const defaults = getDefaultConsoleKeys(console, shared)
  const keys = getConsoleKeys(console, shared, own)
  for (const setting of Object.keys(keys)) {
    if (key && keys[setting] === key) {
      keys[setting] = ''
    }
  }
  keys[keySetting(input)] = key
  return Object.fromEntries(Object.entries(keys).filter(([setting, value]) => defaults[setting] !== value))
}

/** What a key already does in every console's games, if anything: it can't also play a button */
export function getHotkeyOn(shared: KeyboardMapping, key: string): Hotkey | undefined {
  return key ? hotkeys.find((hotkey) => shared[hotkey] === key) : undefined
}
