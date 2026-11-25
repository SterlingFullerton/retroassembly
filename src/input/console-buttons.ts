import { type RetroPadButton, retroPadButtons, toRetroarchInputNames } from './retropad.ts'

// The gamepad buttons a console is played with. Every console starts from the gamepad's own layout, shared by all of
// them. On top of it come the player's own buttons for that console on that gamepad, kept as only what differs

/** A player's own buttons for one console on one gamepad: RetroArch's setting for each button they changed and the
 * gamepad button that plays it, by its number, or 'nul' for none */
export type ConsoleButtons = Record<string, string>

const none = 'nul'

/** RetroArch's setting for the gamepad button that plays an input, such as input_player1_a_btn */
export function buttonSetting(button: RetroPadButton) {
  return `input_player1_${button}_btn` as const
}

/** The gamepad button for each of a console's buttons before the player's own: the gamepad's layout */
export function getDefaultConsoleButtons(gamepad: Record<string, unknown>) {
  const settings = toRetroarchInputNames(gamepad)
  const buttons: ConsoleButtons = {}
  for (const button of retroPadButtons) {
    const value = settings[buttonSetting(button)]
    buttons[buttonSetting(button)] = typeof value === 'string' && value ? value : none
  }
  return buttons
}

// Only settings for the controller's buttons: what's stored comes from outside
function ownButtons(own: ConsoleButtons | null | undefined) {
  const buttons: ConsoleButtons = {}
  for (const button of retroPadButtons) {
    const value = own?.[buttonSetting(button)]
    if (typeof value === 'string' && value) {
      buttons[buttonSetting(button)] = value
    }
  }
  return buttons
}

/** The gamepad button each of a console's buttons is played with: the gamepad's layout with the player's own over it */
export function getConsoleButtons(gamepad: Record<string, unknown>, own?: ConsoleButtons | null) {
  return { ...getDefaultConsoleButtons(gamepad), ...ownButtons(own) }
}

/** The player's own buttons as RetroArch settings, for a game's launch: only those that differ from the layout */
export function getOwnButtonSettings(gamepad: Record<string, unknown>, own?: ConsoleButtons | null) {
  const defaults = getDefaultConsoleButtons(gamepad)
  return Object.fromEntries(Object.entries(ownButtons(own)).filter(([setting, value]) => defaults[setting] !== value))
}

/**
 * The player's own buttons for a console after one is given a gamepad button, or none (''). Another on that gamepad
 * button loses it. What comes back is only what differs from the gamepad's layout
 */
export function bindConsoleButton(
  { gamepad, own }: { gamepad: Record<string, unknown>; own?: ConsoleButtons | null },
  button: RetroPadButton,
  gamepadButton: string,
) {
  const defaults = getDefaultConsoleButtons(gamepad)
  const buttons = getConsoleButtons(gamepad, own)
  const value = gamepadButton || none
  for (const setting of Object.keys(buttons)) {
    if (value !== none && buttons[setting] === value) {
      buttons[setting] = none
    }
  }
  buttons[buttonSetting(button)] = value
  return Object.fromEntries(Object.entries(buttons).filter(([setting, played]) => defaults[setting] !== played))
}

// A gamepad's buttons by their place, in the order browsers number them. The four under the right thumb are drawn by
// where they sit, since each maker letters them differently
const names: Record<string, { icon?: string; key: string }> = {
  0: { icon: 'icon-[mdi--gamepad-circle-down]', key: '' },
  1: { icon: 'icon-[mdi--gamepad-circle-right]', key: '' },
  2: { icon: 'icon-[mdi--gamepad-circle-left]', key: '' },
  3: { icon: 'icon-[mdi--gamepad-circle-up]', key: '' },
  4: { key: 'L1' },
  5: { key: 'R1' },
  6: { key: 'L2' },
  7: { key: 'R2' },
  8: { key: 'Select' },
  9: { key: 'Start' },
  10: { key: 'L3' },
  11: { key: 'R3' },
  12: { key: '↑' },
  13: { key: '↓' },
  14: { key: '←' },
  15: { key: '→' },
  16: { key: 'Home' },
}

/** How a gamepad button is shown: a name, or a picture of its place; nothing for none */
export function gamepadButtonName(value: string): { icon?: string; key: string } {
  if (!value || value === none) {
    return { key: '' }
  }
  return names[value] ?? { key: `#${value}` }
}
