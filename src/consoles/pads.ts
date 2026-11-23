import type { RetroPadButton } from '../input/retropad.ts'
import type { ControlsKind } from './types.ts'

// Each console's controller as the pause menu draws it for a keyboard: which buttons it has, what they're called and
// coloured on the controller, the RetroPad button its emulator reads each from, and roughly where each sits. One entry
// per kind of on-screen controls, whose layouts these follow

/** A button of the controller */
export interface PadButton {
  /** Its colour on the controller */
  color?: string
  /** What it's called on the controller */
  label: string
  retropad: RetroPadButton
}

/** Four directions pressed as one control, and where the emulator reads them from */
export interface PadCluster {
  color?: string
  label: string
  source: 'dpad' | 'left-stick' | 'right-stick'
}

/** Buttons that sit together, in rows from the top; a diamond is a row of one, a row of two and a row of one */
export interface PadGroup {
  label?: string
  rows: PadButton[][]
}

export interface Pad {
  /** Between the two hands: Select, Start and the like */
  center?: PadButton[]
  /** Under the right thumb */
  face: PadButton[][]
  /** The console has a keypad, played with the number keys */
  keypad?: boolean
  /** More buttons under the left hand, such as the WonderSwan's Y pad */
  leftGroup?: PadGroup
  /** Under the left thumb, the main one first */
  moves: PadCluster[]
  /** Directions under the right hand, such as the N64's C buttons */
  rightCluster?: PadCluster
  /** More buttons under the right hand, such as the Virtual Boy's second D-pad */
  rightGroup?: PadGroup
  shoulders?: { left?: PadButton[]; right?: PadButton[] }
}

const dpad: PadCluster = { label: 'D-pad', source: 'dpad' }
const joystick: PadCluster = { label: 'Joystick', source: 'dpad' }
const select: PadButton = { label: 'Select', retropad: 'select' }
const start: PadButton = { label: 'Start', retropad: 'start' }

function button(label: string, retropad: RetroPadButton, color?: string): PadButton {
  return color ? { color, label, retropad } : { label, retropad }
}

// The PlayStation's four symbols in their colours, in a diamond
const playStationFace = [
  [button('△', 'x', '#3fcf8e')],
  [button('□', 'y', '#e88ac8'), button('○', 'a', '#ff5a5a')],
  [button('✕', 'b', '#7aa8ff')],
]

// Nintendo's diamond; `colors` are the Super Famicom's
function nintendoFace(colors?: { a: string; b: string; x: string; y: string }) {
  return [
    [button('X', 'x', colors?.x)],
    [button('Y', 'y', colors?.y), button('A', 'a', colors?.a)],
    [button('B', 'b', colors?.b)],
  ]
}

const gameBoy: Pad = {
  center: [select, start],
  face: [[button('B', 'b', '#e05a95'), button('A', 'a', '#e05a95')]],
  moves: [dpad],
}

const nes: Pad = {
  center: [select, start],
  face: [[button('B', 'b', '#ff5a5a'), button('A', 'a', '#ff5a5a')]],
  moves: [dpad],
}

// Sega's 8-bit consoles: buttons 1 and 2, and the console's Pause or the Game Gear's Start
function sega8Bit(startLabel: string): Pad {
  return {
    center: [button(startLabel, 'start')],
    face: [[button('1', 'b'), button('2', 'a')]],
    moves: [dpad],
  }
}

export const pads: Record<ControlsKind, Pad> = {
  // FinalBurn Neo's cabinet: buttons 1 to 6, coloured as on screen. Select inserts a coin
  arcade: {
    center: [start],
    face: [
      [button('3', 'y', '#5aa8ff'), button('4', 'x', '#4fcf68'), button('5', 'r', '#e6e6ea'), button('6', 'l')],
      [button('1', 'b', '#ff5a5a'), button('2', 'a', '#f1c40f')],
    ],
    moves: [{ label: 'Stick', source: 'dpad' }],
  },
  atari2600: {
    center: [select, button('Reset', 'start')],
    face: [[button('Fire', 'b', '#ff5a5a')]],
    moves: [joystick],
  },
  atari5200: {
    center: [start, button('Pause', 'select')],
    face: [[button('1', 'a', '#ff5a5a'), button('2', 'b', '#ff5a5a')]],
    moves: [joystick],
  },
  atari7800: {
    center: [select, button('Pause', 'start'), button('Reset', 'x')],
    face: [[button('1', 'b', '#ff5a5a'), button('2', 'a', '#ff5a5a')]],
    moves: [joystick],
  },
  // Its stick also pulls up, pushes down and twists either way
  channelf: {
    center: [button('Swap', 'select'), button('Console', 'start')],
    face: [[button('Pull', 'x')], [button('Twist L', 'y'), button('Twist R', 'a')], [button('Push', 'b')]],
    moves: [joystick],
  },
  colecovision: {
    center: [button('✱', 'start'), button('#', 'select')],
    face: [[button('Fire L', 'b', '#f5944a'), button('Fire R', 'a', '#f5944a')]],
    keypad: true,
    moves: [joystick],
  },
  // Blowing into the microphone is the RetroPad's L3
  ds: {
    center: [select, start, button('Mic', 'l3')],
    face: nintendoFace(),
    moves: [dpad],
    shoulders: { left: [button('L', 'l')], right: [button('R', 'r')] },
  },
  fds: nes,
  gamegear: sega8Bit('Start'),
  gb: gameBoy,
  gba: {
    center: [select, start],
    face: [[button('B', 'b'), button('A', 'a')]],
    moves: [dpad],
    shoulders: { left: [button('L', 'l')], right: [button('R', 'r')] },
  },
  // A console drawn with the RetroPad's own layout
  generic: {
    center: [select, start],
    face: nintendoFace(),
    moves: [dpad],
    shoulders: {
      left: [button('L', 'l'), button('L2', 'l2')],
      right: [button('R2', 'r2'), button('R', 'r')],
    },
  },
  // The 6-button pad: X, Y and Z above A, B and C
  genesis: {
    center: [button('Mode', 'select'), start],
    face: [
      [button('X', 'l'), button('Y', 'x'), button('Z', 'r')],
      [button('A', 'y'), button('B', 'b'), button('C', 'a')],
    ],
    moves: [dpad],
  },
  // Select opens the emulator's menu and Start picks from it
  gw: {
    center: [button('Menu', 'select'), button('OK', 'start')],
    face: [[button('B', 'b'), button('A', 'a')]],
    moves: [dpad],
  },
  lynx: {
    center: [button('Opt 1', 'l'), button('Opt 2', 'r'), button('Pause', 'start'), button('Rotate', 'select')],
    face: [[button('B', 'a'), button('A', 'b')]],
    moves: [dpad],
  },
  mastersystem: sega8Bit('Pause'),
  // The stick is the main control; the C buttons are the right stick, and Z the RetroPad's L2
  n64: {
    center: [button('Start', 'start', '#ff6b5e')],
    face: [[button('B', 'y', '#4fcf68'), button('A', 'b', '#6f9bff')]],
    moves: [{ label: 'Stick', source: 'left-stick' }, dpad],
    rightCluster: { color: '#f2c21a', label: 'C', source: 'right-stick' },
    shoulders: { left: [button('L', 'l'), button('Z', 'l2')], right: [button('R', 'r')] },
  },
  nes,
  ngp: {
    center: [button('Option', 'start')],
    face: [[button('A', 'b'), button('B', 'a')]],
    moves: [dpad],
  },
  odyssey2: {
    face: [[button('Action', 'b', '#ff5a5a')]],
    moves: [joystick],
  },
  pcengine: {
    center: [select, button('Run', 'start')],
    face: [[button('II', 'b'), button('I', 'a')]],
    moves: [dpad],
  },
  psp: {
    center: [select, start],
    face: playStationFace,
    moves: [dpad],
    shoulders: { left: [button('L', 'l')], right: [button('R', 'r')] },
  },
  psx: {
    center: [select, start],
    face: playStationFace,
    moves: [dpad],
    shoulders: {
      left: [button('L1', 'l'), button('L2', 'l2')],
      right: [button('R2', 'r2'), button('R1', 'r')],
    },
  },
  snes: {
    center: [select, start],
    face: nintendoFace({ a: '#ff6b5e', b: '#f1c40f', x: '#6f9bff', y: '#4fcf68' }),
    moves: [dpad],
    shoulders: { left: [button('L', 'l')], right: [button('R', 'r')] },
  },
  // Its second D-pad is the RetroPad's L2, L3, R2 and R3
  vb: {
    center: [select, start],
    face: [[button('B', 'b'), button('A', 'a')]],
    moves: [dpad],
    rightGroup: {
      label: 'Right D-pad',
      rows: [[button('↑', 'l2')], [button('←', 'r2'), button('→', 'r3')], [button('↓', 'l3')]],
    },
    shoulders: { left: [button('L', 'l')], right: [button('R', 'r')] },
  },
  // The Y pad is four buttons, read from the shoulders
  wonderswan: {
    center: [start, button('Rotate', 'select')],
    face: [[button('B', 'b'), button('A', 'a')]],
    leftGroup: {
      label: 'Y pad',
      rows: [[button('Y1', 'r2')], [button('Y4', 'l'), button('Y2', 'r')], [button('Y3', 'l2')]],
    },
    moves: [{ label: 'X pad', source: 'dpad' }],
  },
}
