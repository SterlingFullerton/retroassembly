// Keys some emulators need that the keyboard mapping shared by every system leaves unbound. The N64's Z trigger is
// the RetroPad's L2 and its C buttons are the right stick, none of which has a key by default, so on a keyboard they
// couldn't be pressed at all. E sits with Q and W (L and R) as a shoulder row; I, J, K and L are the C buttons.
const keysByCore: Record<string, Record<string, string>> = {
  mupen64plus_next: {
    input_player1_l2: 'e',
    input_player1_r_x_minus: 'j',
    input_player1_r_x_plus: 'l',
    input_player1_r_y_minus: 'i',
    input_player1_r_y_plus: 'k',
  },
}

/**
 * The keys an emulator gets on top of the keyboard mapping. Each is added only if the player hasn't bound that input
 * themselves and the key isn't already used for something else.
 */
export function getCoreKeyboardKeys(core: string | undefined, keyboardMapping: Record<string, string>) {
  const keys = keysByCore[core ?? '']
  if (!keys) {
    return {}
  }
  const usedKeys = new Set(Object.values(keyboardMapping).filter(Boolean))
  return Object.fromEntries(
    Object.entries(keys).filter(([input, key]) => !keyboardMapping[input] && !usedKeys.has(key)),
  )
}
