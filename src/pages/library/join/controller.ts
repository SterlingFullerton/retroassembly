import { platformMap } from '#@/constants/platform.ts'
import { padButtonCount } from '#@/emulator/play-together.ts'
import { type PadSource, standardButton } from '#@/input/guest-pad.ts'
import { retroPadButtons } from '#@/input/retropad.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'

// What the join page plays with and shows, worked out apart from the page so it can be tested

// The names the gamepad settings call the shoulder buttons by
const settingNames: Partial<Record<string, string>> = { l: 'l1', r: 'r1' }

/**
 * A controller as the game hears it: where the player has set which of its buttons plays which in Settings, as they do
 * for a controller that isn't laid out the standard way, each button is moved to its standard place. As it is where
 * they haven't
 */
export function remapController(
  controller: PadSource | null | undefined,
  mapping: Readonly<Record<string, string>> | null | undefined,
): PadSource | undefined {
  if (!controller || !mapping) {
    return controller ?? undefined
  }
  const buttons = Array.from({ length: padButtonCount }, () => ({ pressed: false }))
  for (const button of retroPadButtons) {
    const setting = mapping[`input_player1_${settingNames[button] ?? button}_btn`]
    const from = setting === undefined || setting === '' ? standardButton[button] : Number(setting)
    if (Number.isInteger(from) && controller.buttons?.[from]?.pressed) {
      buttons[standardButton[button]].pressed = true
    }
  }
  return { axes: controller.axes, buttons }
}

// The settings' names for the buttons a shortcut such as pause is made of
const shortcutButtons: Record<string, string> = {
  Down: 'input_player1_down_btn',
  L1: 'input_player1_l1_btn',
  L2: 'input_player1_l2_btn',
  L3: 'input_player1_l3_btn',
  R1: 'input_player1_r1_btn',
  R2: 'input_player1_r2_btn',
  R3: 'input_player1_r3_btn',
  Select: 'input_player1_select_btn',
  Start: 'input_player1_start_btn',
}

/** Whether every button of a shortcut, such as pause's "L1 + R1", is held on a controller, by the gamepad's settings */
export function holdsShortcut(
  buttons: readonly { pressed: boolean }[],
  shortcut: string,
  mapping: Readonly<Record<string, string>>,
) {
  const parts = shortcut.split(/\s+\+\s+/u).filter(Boolean)
  return (
    parts.length > 0 &&
    parts.every((part) => {
      const index = Number(mapping[shortcutButtons[part] ?? ''])
      return Number.isInteger(index) && buttons[index]?.pressed
    })
  )
}

// Every extension a game's file can have, for a game whose console isn't known, such as one in the list of games
const anyExtension = [
  ...new Set([
    ...Object.values(platformMap).flatMap((info) => info.fileExtensions as readonly string[]),
    '.zip',
    '.7z',
  ]),
]

/**
 * A game on the server's name as the library shows it. The server names it by its title, or else its file, whose
 * extension is left off; a period in the name, as in "Dr. Kawashima", is kept
 */
export function serverGameTitle(title: string, platform?: string) {
  const own = platform ? platformMap[platform as keyof typeof platformMap]?.fileExtensions : undefined
  const extensions: readonly string[] = own ? [...own, '.zip', '.7z'] : anyExtension
  const lower = title.toLowerCase()
  const extension = extensions.find((candidate) => lower.endsWith(candidate.toLowerCase()))
  const name = extension ? title.slice(0, -extension.length) : title
  return getRomGoodcodes({ name, platform }).rom || title
}
