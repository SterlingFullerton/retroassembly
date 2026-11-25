import type { ResolvedConsole } from '../consoles/registry.ts'
import { type ConsoleButtons, getOwnButtonSettings } from './console-buttons.ts'
import { type ConsoleKeys, getOwnKeySettings } from './console-keys.ts'
import { getKeyboardHints } from './hints.ts'
import { getConsoleKeyboardConfig } from './keyboard.ts'
import { stickAxisSettings, toRetroarchInputNames } from './retropad.ts'

type Settings = Record<string, unknown>

// One source of RetroArch input settings. A setting may be written by only one rule, unless a later rule names the
// earlier one in `replaces`: that's where the later rule is meant to win
interface Rule {
  name: string
  replaces?: string[]
  settings: Settings
}

/** Applies the rules in order, refusing one that writes a setting an earlier rule wrote without saying it replaces it */
export function combineRules(rules: Rule[]) {
  const writers = new Map<string, string>()
  const settings: Settings = {}
  for (const { name, replaces = [], settings: ruleSettings } of rules) {
    for (const [setting, value] of Object.entries(ruleSettings)) {
      const writer = writers.get(setting)
      if (writer && !replaces.includes(writer)) {
        throw new Error(`The ${name} rule writes ${setting}, which the ${writer} rule already wrote`)
      }
      writers.set(setting, name)
      settings[setting] = value
    }
  }
  return settings
}

// The app's own hotkey settings, such as $pause, which the page acts on itself; RetroArch has no use for them
function withoutAppHotkeys(mapping: Record<string, string>) {
  return Object.fromEntries(Object.entries(mapping).filter(([name]) => !name.startsWith('$')))
}

interface InputConfigOptions {
  console: Pick<ResolvedConsole, 'coin' | 'controller' | 'hints' | 'keyboard' | 'launch'>
  /** The gamepad mapping, with its hotkey buttons resolved */
  gamepad: Record<string, string>
  /** The keyboard mapping shared by every console */
  keyboard: Record<string, string>
  /** The player's own buttons for this console on the gamepad in use */
  ownButtons?: ConsoleButtons | null
  /** The player's own keys for this console */
  ownKeys?: ConsoleKeys | null
  /** Where the emulator looks for remap files, for the PlayStation's DualShock */
  remapDirectory: string
  /** The on-screen gamepad has analog sticks */
  touch: boolean
}

/** The RetroArch input settings a game starts with, and the pause menu's keyboard hints for it */
export function buildInputConfig({
  console,
  gamepad,
  keyboard,
  ownButtons,
  ownKeys,
  remapDirectory,
  touch,
}: InputConfigOptions) {
  const { stickAxes, dualShockRemap } = console.launch
  const retroarchConfig = combineRules([
    {
      // The D-pad's keys and buttons also move the left stick, for games that read only the stick
      name: 'analog D-pad',
      settings: {
        input_player1_analog_dpad_mode: 1,
        input_player2_analog_dpad_mode: 1,
        input_player3_analog_dpad_mode: 1,
        input_player4_analog_dpad_mode: 1,
      },
    },
    { name: 'keyboard', settings: toRetroarchInputNames(withoutAppHotkeys(keyboard)) },
    { name: 'gamepad', settings: toRetroarchInputNames(withoutAppHotkeys(gamepad)) },
    {
      // RetroArch's web build swaps the left stick's up and down keys
      name: 'stick fix',
      replaces: ['keyboard'],
      settings: {
        input_player1_l_y_minus: keyboard.input_player1_l_y_plus,
        input_player1_l_y_plus: keyboard.input_player1_l_y_minus,
      },
    },
    {
      // Keys the console needs beyond the shared mapping, such as the N64's Z, C buttons and separate stick and D-pad
      name: 'console keys',
      replaces: ['analog D-pad', 'keyboard', 'stick fix'],
      settings: getConsoleKeyboardConfig(console, keyboard),
    },
    {
      // The keys the player gave this console's buttons in its settings
      name: 'own console keys',
      replaces: ['keyboard', 'stick fix', 'console keys'],
      settings: getOwnKeySettings(console, keyboard, ownKeys),
    },
    {
      // The gamepad buttons the player gave this console's buttons in its settings
      name: 'own console buttons',
      replaces: ['gamepad'],
      settings: getOwnButtonSettings(gamepad, ownButtons),
    },
    {
      // On a touch screen the on-screen gamepad's sticks are the emulator's analog sticks. The PlayStation's are a
      // DualShock's, which a remap file tells its emulator. Games that don't use the sticks still see a digital pad
      name: 'touch sticks',
      replaces: ['analog D-pad', 'console keys'],
      settings:
        touch && stickAxes
          ? {
              ...stickAxisSettings(stickAxes),
              ...(dualShockRemap ? { input_remapping_directory: remapDirectory } : {}),
            }
          : {},
    },
  ])
  return { hints: getKeyboardHints(console, keyboard), retroarchConfig }
}
