// The keys that move around the library, apart from the arrows, Enter, Space and Backspace, which always do. They're
// the app's own (their names start with $, so RetroArch is never given them) and are kept in the keyboard mapping.
// Until one is set it's the key the shared layout gives the matching game button, as it always was

export const navigationKeyNames = ['$up', '$down', '$left', '$right', '$confirm', '$cancel'] as const
export type NavigationKeyName = (typeof navigationKeyNames)[number]
export type NavigationKeys = Record<NavigationKeyName, string>

/** What the app does itself, or has RetroArch do, while a game runs */
export const hotkeyNames = ['$pause', 'input_rewind', 'input_hold_fast_forward'] as const
export type HotkeyName = (typeof hotkeyNames)[number]

type KeyboardMapping = Record<string, null | string | undefined>

/** The library's keys: each as set, '' for none, or else the key of the game button it used to share */
export function getNavigationKeys(mapping: KeyboardMapping, confirmStyle: 'nintendo' | 'xbox'): NavigationKeys {
  const [confirm, cancel] =
    confirmStyle === 'nintendo'
      ? [mapping.input_player1_a, mapping.input_player1_b]
      : [mapping.input_player1_b, mapping.input_player1_a]
  const fallback: Record<NavigationKeyName, null | string | undefined> = {
    $cancel: cancel,
    $confirm: confirm,
    $down: mapping.input_player1_down,
    $left: mapping.input_player1_left,
    $right: mapping.input_player1_right,
    $up: mapping.input_player1_up,
  }
  const keys = {} as NavigationKeys
  for (const name of navigationKeyNames) {
    keys[name] = mapping[name] ?? fallback[name] ?? ''
  }
  return keys
}

/** The mapping's changes that give one of the library's keys a key, or none (''): another of them on it loses it */
export function bindNavigationKey(keys: NavigationKeys, name: NavigationKeyName, key: string) {
  const changes: Partial<NavigationKeys> = { [name]: key }
  for (const other of navigationKeyNames) {
    if (key && other !== name && keys[other] === key) {
      changes[other] = ''
    }
  }
  return changes
}

/** Whether the shared layout gives a key to a game button: such a key can't also pause, rewind or fast-forward */
export function playsGameButton(mapping: KeyboardMapping, key: string) {
  return Object.entries(mapping).some(
    ([name, value]) => name.startsWith('input_player1_') && Boolean(key) && value === key,
  )
}

/** The mapping's changes that give a shortcut a key, or none (''): another shortcut on it loses it */
export function bindHotkey(mapping: KeyboardMapping, name: HotkeyName, key: string) {
  const changes: Partial<Record<HotkeyName, string>> = { [name]: key }
  for (const other of hotkeyNames) {
    if (key && other !== name && mapping[other] === key) {
      changes[other] = ''
    }
  }
  return changes
}
