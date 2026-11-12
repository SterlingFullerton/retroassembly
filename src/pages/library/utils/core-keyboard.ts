type KeyboardMapping = Record<string, string>

// The keys each N64 control is played with on a keyboard
export interface N64Keys {
  c: string[]
  dpad: string[]
  stick: string[]
  z?: string
}

// Keys for inputs the N64 needs that the keyboard mapping shared by every system leaves unbound: its Z trigger is the
// RetroPad's L2 and its C buttons are the right stick. E sits with Q and W (L and R) as a shoulder row; I, J, K and L
// are the C buttons, and T, F, G and H the D-pad.
const n64Defaults = {
  c: {
    input_player1_r_x_minus: 'j',
    input_player1_r_x_plus: 'l',
    input_player1_r_y_minus: 'i',
    input_player1_r_y_plus: 'k',
  },
  dpad: { input_player1_down: 'g', input_player1_left: 'f', input_player1_right: 'h', input_player1_up: 't' },
  z: { input_player1_l2: 'e' },
}

const stickInputs = [
  'input_player1_l_y_minus',
  'input_player1_l_y_plus',
  'input_player1_l_x_minus',
  'input_player1_l_x_plus',
]

/**
 * The N64's keys: the RetroArch settings that bind them, and the keys for each control, for the key hint. A default is
 * used only for an input the player hasn't bound themselves, and only if its key isn't already used for something else.
 */
export function getN64Keyboard(mapping: KeyboardMapping) {
  const config: Record<string, number | string> = {}
  const usedKeys = new Set(Object.values(mapping).filter(Boolean))
  function addDefault(input: string, key: string) {
    if (!mapping[input] && !usedKeys.has(key)) {
      config[input] = key
    }
  }

  for (const [input, key] of Object.entries({ ...n64Defaults.c, ...n64Defaults.z })) {
    addDefault(input, key)
  }

  const dpadInputs = ['input_player1_up', 'input_player1_down', 'input_player1_left', 'input_player1_right'] as const
  const ownStickKeys = stickInputs.some((input) => mapping[input])
  // Unless the player has given the stick keys of their own, the keys they play the D-pad with on other systems (the
  // arrows) move to the stick, the N64's main control, and the D-pad gets T, F, G and H. The D-pad then stops standing
  // in for the stick
  if (!ownStickKeys) {
    const [up, down, left, right] = dpadInputs.map((input) => mapping[input])
    Object.assign(config, {
      input_player1_analog_dpad_mode: 0,
      input_player1_l_x_minus: left,
      input_player1_l_x_plus: right,
      input_player1_l_y_minus: up,
      input_player1_l_y_plus: down,
    })
    for (const input of dpadInputs) {
      const key = n64Defaults.dpad[input]
      config[input] = usedKeys.has(key) ? '' : key
    }
  }

  function keyOf(input: string) {
    return String(config[input] ?? mapping[input] ?? '')
  }
  const cInputs = [
    'input_player1_r_y_minus',
    'input_player1_r_x_minus',
    'input_player1_r_y_plus',
    'input_player1_r_x_plus',
  ]
  const keys: N64Keys = {
    c: cInputs.map((input) => keyOf(input)),
    dpad: dpadInputs.map((input) => keyOf(input)),
    stick: ownStickKeys
      ? stickInputs.map((input) => mapping[input] ?? '')
      : dpadInputs.map((input) => mapping[input] ?? ''),
    z: keyOf('input_player1_l2') || undefined,
  }
  return { config, keys }
}

// The ColecoVision's keypad on the number keys. Gearcoleco reads keys 1 to 6 from the RetroPad's Y, X, L, R, L2 and R2,
// 7 and 8 from the stick clicks, and 9 and 0 from the left stick pushed down and right. ✱ and # stay on Start and Select
const colecoVisionKeypad = [
  ['1', 'input_player1_y', 'input_player1_y'],
  ['2', 'input_player1_x', 'input_player1_x'],
  ['3', 'input_player1_l1', 'input_player1_l'],
  ['4', 'input_player1_r1', 'input_player1_r'],
  ['5', 'input_player1_l2', 'input_player1_l2'],
  ['6', 'input_player1_r2', 'input_player1_r2'],
  ['7', 'input_player1_l3', 'input_player1_l3'],
  ['8', 'input_player1_r3', 'input_player1_r3'],
  ['9', 'input_player1_l_y_plus', 'input_player1_l_y_plus'],
  ['0', 'input_player1_l_x_plus', 'input_player1_l_x_plus'],
] as const

/**
 * The ColecoVision's keys: the number keys play its keypad, each unless the player uses that key for something else,
 * in which case the keypad key keeps its usual key. Returns the RetroArch settings, and each keypad key's key for the
 * key hint.
 */
export function getColecoVisionKeyboard(mapping: KeyboardMapping) {
  const keypadInputs = new Set<string>(colecoVisionKeypad.map(([, input]) => input))
  const usedKeys = new Set(
    Object.entries(mapping)
      .filter(([input, key]) => key && !keypadInputs.has(input))
      .map(([, key]) => key),
  )
  // The left stick stays a stick, so that 9 and 0 aren't taken for the joystick moving down and right
  const config: Record<string, number | string> = { input_player1_analog_dpad_mode: 0 }
  const keypad: Record<string, string> = {}
  for (const [label, input, retroarchInput] of colecoVisionKeypad) {
    const numberKey = `num${label}`
    const key = usedKeys.has(numberKey) ? mapping[input] : numberKey
    config[retroarchInput] = key ?? ''
    if (key) {
      keypad[label] = key
    }
  }
  // Gearcoleco takes the left stick pushed either way as 9 or 0, so the other directions mustn't keep keys of their own
  config.input_player1_l_x_minus = ''
  config.input_player1_l_y_minus = ''
  return { config, keys: { keypad } }
}

/** RetroArch settings for the keys an emulator needs beyond the shared keyboard mapping */
export function getCoreKeyboardConfig(core: string | undefined, mapping: KeyboardMapping) {
  if (core === 'mupen64plus_next') {
    return getN64Keyboard(mapping).config
  }
  if (core === 'gearcoleco') {
    return getColecoVisionKeyboard(mapping).config
  }
  return {}
}
