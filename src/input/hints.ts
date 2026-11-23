import { capitalize, compact } from 'es-toolkit'
import type { ResolvedConsole } from '../consoles/registry.ts'
import type { ControllerButton } from '../consoles/types.ts'
import { getColecoVisionKeyboard, getControllerKeyboard, getN64Keyboard, getOdyssey2Keyboard } from './keyboard.ts'

type KeyboardMapping = Record<string, string>

/** What a hint names: a button of the console's controller, an icon, or a translated command such as Pause */
export type HintLabel = { button: string; color?: string } | { icon: string } | { text: string }

/** One line of the pause menu's keyboard hints: the keys, and what they do */
export interface KeyboardHint {
  keyNames: string[]
  message: HintLabel
}

// RetroArch's names for modifier keys, spelled out for the hint
export const modifierKeyNames: Record<string, string> = {
  lalt: 'Left Alt',
  lctrl: 'Left Ctrl',
  lshift: 'Left Shift',
  ralt: 'Right Alt',
  rctrl: 'Right Ctrl',
  rshift: 'Right Shift',
}

const arrowNames: Record<string, string> = { down: '↓', left: '←', right: '→', up: '↑' }

export function keyName(key: string) {
  // RetroArch calls the number keys num0 to num9
  const numberKey = /^num(?<digit>\d)$/u.exec(key)?.groups?.digit
  return numberKey ?? arrowNames[key] ?? modifierKeyNames[key] ?? capitalize(key)
}

// Several keys shown as one, such as the four arrows
function joinKeys(...keys: (string | undefined)[]) {
  return compact(keys)
    .map((key) => keyName(key))
    .join(' ')
}

// The keypad's keys, shown as one range when they are on the number keys
export function keypadKeyNames(keypad: Record<string, string>) {
  const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  if (labels.every((label) => keypad[label] === `num${label}`)) {
    return '1 – 0'
  }
  return labels
    .filter((label) => keypad[label])
    .map((label) => `${label}: ${keyName(keypad[label])}`)
    .join(' ')
}

function button({ color, label }: Pick<ControllerButton, 'color' | 'label'>): HintLabel {
  return color ? { button: label, color } : { button: label }
}

// A button of the console's controller, found by its name there
function controllerButton(controller: ControllerButton[], label: string) {
  const found = controller.find((item) => item.label === label)
  if (!found) {
    throw new Error(`The controller has no ${label} button`)
  }
  return found
}

// A button of the console's controller as a hint names it
function labelled(controller: ControllerButton[], label: string) {
  return button(controllerButton(controller, label))
}

function hint(keyNames: string, message: HintLabel): KeyboardHint {
  return { keyNames: compact([keyNames]), message }
}

/**
 * The pause menu's keyboard hints for a console: its controller's buttons named, and coloured, as on the controller
 * where the registry describes it, the arrows and four face buttons elsewhere, then coin, pause, rewind and fast
 * forward. Lines without a key are left out.
 */
export function getKeyboardHints(
  { coin, controller, hints, keyboard }: Pick<ResolvedConsole, 'coin' | 'controller' | 'hints' | 'keyboard'>,
  sharedMapping: KeyboardMapping,
) {
  // O2EM takes the keys the Odyssey²'s keyboard has off the controller buttons and shortcuts
  const mapping = keyboard === 'odyssey2' ? getOdyssey2Keyboard(sharedMapping).mapping : sharedMapping
  const directions = joinKeys(
    mapping.input_player1_up,
    mapping.input_player1_down,
    mapping.input_player1_left,
    mapping.input_player1_right,
  )
  const lines: KeyboardHint[] = []

  if (hints === 'n64') {
    // The RetroPad's B, Y, L2 and right stick are the N64's A, B, Z and C buttons (its emulator ignores the RetroPad's X
    // and A), and the stick and D-pad have keys of their own
    const { keys } = getN64Keyboard(mapping)
    lines.push(
      hint(joinKeys(...keys.stick), { button: 'Stick' }),
      hint(joinKeys(...keys.dpad), { button: 'D-pad' }),
      hint(joinKeys(mapping.input_player1_b), labelled(controller, 'A')),
      hint(joinKeys(mapping.input_player1_y), labelled(controller, 'B')),
      hint(joinKeys(...keys.c), { button: 'C', color: '#f2c21a' }),
      hint(joinKeys(keys.z), labelled(controller, 'Z')),
      hint(joinKeys(mapping.input_player1_l1), labelled(controller, 'L')),
      hint(joinKeys(mapping.input_player1_r1), labelled(controller, 'R')),
      hint(joinKeys(mapping.input_player1_start), labelled(controller, 'Start')),
    )
  } else if (hints === 'colecovision') {
    // Its joystick, two orange fire buttons and keypad
    lines.push(
      hint(directions, { button: 'Joystick' }),
      hint(joinKeys(mapping.input_player1_b), labelled(controller, 'Fire L')),
      hint(joinKeys(mapping.input_player1_a), labelled(controller, 'Fire R')),
      hint(keypadKeyNames(getColecoVisionKeyboard(mapping).keys.keypad), { button: 'Keypad' }),
      hint(joinKeys(mapping.input_player1_start), labelled(controller, '✱')),
      hint(joinKeys(mapping.input_player1_select), labelled(controller, '#')),
    )
  } else if (hints === 'genesis' || hints === 'arcade') {
    // Named after the controller's buttons: the Genesis's A B C, the 6-button pad's X Y Z, Start and Mode; a cabinet's
    // stick, buttons 1 to 6, coloured as on screen, and Start. Coin is listed with the other arcade keys below
    const { keys } = getControllerKeyboard(controller, mapping)
    lines.push(hint(directions, { button: hints === 'genesis' ? 'D-pad' : 'Stick' }))
    for (const item of controller) {
      const played = item.key ? keys[item.label] : mapping[`input_player1_${item.retropad}`]
      lines.push(hint(joinKeys(played), button(item)))
    }
  } else {
    // The arrows and the four face buttons, shown by their place in the diamond
    lines.push(
      {
        keyNames: [
          compact([
            mapping.input_player1_up,
            mapping.input_player1_down,
            mapping.input_player1_left,
            mapping.input_player1_right,
          ])
            .map((key) => arrowNames[key] || capitalize(key))
            .join(' '),
        ],
        message: { icon: 'mdi--gamepad' },
      },
      { keyNames: compact([mapping.input_player1_x]), message: { icon: 'mdi--gamepad-circle-up' } },
      hint(joinKeys(mapping.input_player1_y), { icon: 'mdi--gamepad-circle-left' }),
      hint(joinKeys(mapping.input_player1_a), { icon: 'mdi--gamepad-circle-right' }),
      hint(joinKeys(mapping.input_player1_b), { icon: 'mdi--gamepad-circle-down' }),
    )
  }

  const coinKey = coin ? sharedMapping.input_player1_select : undefined
  if (coinKey) {
    lines.push({ keyNames: [modifierKeyNames[coinKey] ?? coinKey], message: { text: 'emulator.insertCoin' } })
  }
  lines.push(
    { keyNames: compact([mapping.$pause]), message: { text: 'emulator.pause' } },
    { keyNames: compact([mapping.input_rewind]), message: { text: 'emulator.rewind' } },
    { keyNames: compact([mapping.input_hold_fast_forward]), message: { text: 'emulator.fastForward' } },
  )
  return lines.filter(({ keyNames }) => keyNames.length)
}
