import { capitalize, compact } from 'es-toolkit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import {
  getArcadeKeyboard,
  getColecoVisionKeyboard,
  getGenesisKeyboard,
  getN64Keyboard,
  getOdyssey2Keyboard,
} from '#@/pages/library/utils/core-keyboard.ts'
import { GameInputMessageItem } from './game-input-message-item.tsx'

// RetroArch's names for modifier keys, spelled out for the hint
const modifierKeyNames: Record<string, string> = {
  lalt: 'Left Alt',
  lctrl: 'Left Ctrl',
  lshift: 'Left Shift',
  ralt: 'Right Alt',
  rctrl: 'Right Ctrl',
  rshift: 'Right Shift',
}

const arrowNames: Record<string, string> = { down: '↓', left: '←', right: '→', up: '↑' }

function keyName(key: string) {
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
function keypadKeyNames(keypad: Record<string, string>) {
  const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  if (labels.every((label) => keypad[label] === `num${label}`)) {
    return '1 – 0'
  }
  return labels
    .filter((label) => keypad[label])
    .map((label) => `${label}: ${keyName(keypad[label])}`)
    .join(' ')
}

// A console's buttons named, and coloured, as on its controller
function ConsoleButton({ children, color }: Readonly<{ children: ReactNode; color?: string }>) {
  return (
    <span className='font-bold' style={color ? { color } : undefined}>
      {children}
    </span>
  )
}

export function GameInputMessage() {
  const { t } = useTranslation()
  const { connected } = useGamepads()
  const gamepadMapping = useGamepadMapping()
  const { keyboard: sharedKeyboardMapping } = useInputMapping()
  const { preference } = usePreference()
  const rom = useRom()
  const rewindEnabled = rom ? preference.emulator.platform[rom.platform].rewindEnabled : true
  // Arcade games take a coin with Select, which the hint otherwise doesn't mention
  const coinKey = rom?.platform === 'arcade' ? sharedKeyboardMapping.input_player1_select : undefined
  const core = rom ? preference.emulator.platform[rom.platform]?.core : undefined
  // O2EM takes the keys the Odyssey²'s keyboard has off the controller buttons and shortcuts
  const keyboardMapping = core === 'o2em' ? getOdyssey2Keyboard(sharedKeyboardMapping).mapping : sharedKeyboardMapping
  const n64Keys = getN64Keyboard(keyboardMapping).keys

  // On the N64 the keys play its controller: the RetroPad's B, Y, L2 and right stick are its A, B, Z and C buttons (its
  // emulator ignores the RetroPad's X and A), and the stick and D-pad have keys of their own
  const n64Messages: { keyNames: string[]; message: ReactNode }[] = [
    { keyNames: compact([joinKeys(...n64Keys.stick)]), message: <ConsoleButton>Stick</ConsoleButton> },
    { keyNames: compact([joinKeys(...n64Keys.dpad)]), message: <ConsoleButton>D-pad</ConsoleButton> },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_b)]),
      message: <ConsoleButton color='#6f9bff'>A</ConsoleButton>,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_y)]),
      message: <ConsoleButton color='#4fcf68'>B</ConsoleButton>,
    },
    { keyNames: compact([joinKeys(...n64Keys.c)]), message: <ConsoleButton color='#f2c21a'>C</ConsoleButton> },
    { keyNames: compact([joinKeys(n64Keys.z)]), message: <ConsoleButton>Z</ConsoleButton> },
    { keyNames: compact([joinKeys(keyboardMapping.input_player1_l1)]), message: <ConsoleButton>L</ConsoleButton> },
    { keyNames: compact([joinKeys(keyboardMapping.input_player1_r1)]), message: <ConsoleButton>R</ConsoleButton> },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_start)]),
      message: <ConsoleButton color='#ff6b5e'>Start</ConsoleButton>,
    },
  ]

  // On the ColecoVision the keys play its controller: its joystick, two orange fire buttons and keypad
  const colecoVisionKeypad = getColecoVisionKeyboard(keyboardMapping).keys.keypad
  const colecoVisionMessages: { keyNames: string[]; message: ReactNode }[] = [
    {
      keyNames: compact([
        joinKeys(
          keyboardMapping.input_player1_up,
          keyboardMapping.input_player1_down,
          keyboardMapping.input_player1_left,
          keyboardMapping.input_player1_right,
        ),
      ]),
      message: <ConsoleButton>Joystick</ConsoleButton>,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_b)]),
      message: <ConsoleButton color='#f5944a'>Fire L</ConsoleButton>,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_a)]),
      message: <ConsoleButton color='#f5944a'>Fire R</ConsoleButton>,
    },
    { keyNames: compact([keypadKeyNames(colecoVisionKeypad)]), message: <ConsoleButton>Keypad</ConsoleButton> },
    { keyNames: compact([joinKeys(keyboardMapping.input_player1_start)]), message: <ConsoleButton>✱</ConsoleButton> },
    { keyNames: compact([joinKeys(keyboardMapping.input_player1_select)]), message: <ConsoleButton>#</ConsoleButton> },
  ]

  // On the Genesis the keys are named after its buttons: A B C, the 6-button pad's X Y Z, Start and Mode
  const isGenesis = core === 'genesis_plus_gx' && (rom?.platform === 'genesis' || rom?.platform === 'megadrive')
  const genesisKeys = getGenesisKeyboard(keyboardMapping).keys
  const genesisMessages: { keyNames: string[]; message: ReactNode }[] = [
    {
      keyNames: compact([
        joinKeys(
          keyboardMapping.input_player1_up,
          keyboardMapping.input_player1_down,
          keyboardMapping.input_player1_left,
          keyboardMapping.input_player1_right,
        ),
      ]),
      message: <ConsoleButton>D-pad</ConsoleButton>,
    },
    ...['A', 'B', 'C', 'X', 'Y', 'Z'].map((label) => ({
      keyNames: compact([joinKeys(genesisKeys[label])]),
      message: <ConsoleButton>{label}</ConsoleButton>,
    })),
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_start)]),
      message: <ConsoleButton>Start</ConsoleButton>,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_select)]),
      message: <ConsoleButton>Mode</ConsoleButton>,
    },
  ]

  // Arcade games with FinalBurn Neo: the stick, and buttons 1 to 6 by their numbers, coloured as on screen. Coin is
  // listed with the other arcade keys below
  const isFBNeo = core === 'fbneo'
  const arcadeKeys = getArcadeKeyboard(keyboardMapping).keys
  const arcadeColors: Record<string, string | undefined> = {
    '1': '#ff5a5a',
    '2': '#f1c40f',
    '3': '#5aa8ff',
    '4': '#4fcf68',
    '5': '#e6e6ea',
  }
  const arcadeMessages: { keyNames: string[]; message: ReactNode }[] = [
    {
      keyNames: compact([
        joinKeys(
          keyboardMapping.input_player1_up,
          keyboardMapping.input_player1_down,
          keyboardMapping.input_player1_left,
          keyboardMapping.input_player1_right,
        ),
      ]),
      message: <ConsoleButton>Stick</ConsoleButton>,
    },
    ...['1', '2', '3', '4', '5', '6'].map((label) => ({
      keyNames: compact([joinKeys(arcadeKeys[label])]),
      message: <ConsoleButton color={arcadeColors[label]}>{label}</ConsoleButton>,
    })),
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_start)]),
      message: <ConsoleButton>Start</ConsoleButton>,
    },
  ]

  // Elsewhere, the arrows and the four face buttons, shown by their place in the diamond
  const genericMessages: { keyNames: string[]; message: ReactNode }[] = [
    {
      keyNames: [
        compact([
          keyboardMapping.input_player1_up,
          keyboardMapping.input_player1_down,
          keyboardMapping.input_player1_left,
          keyboardMapping.input_player1_right,
        ])
          .map((key) => arrowNames[key] || capitalize(key))
          .join(' '),
      ],
      message: <span className='icon-[mdi--gamepad]' />,
    },
    {
      keyNames: compact([keyboardMapping.input_player1_x]),
      message: <span className='icon-[mdi--gamepad-circle-up]' />,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_y)]),
      message: <span className='icon-[mdi--gamepad-circle-left]' />,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_a)]),
      message: <span className='icon-[mdi--gamepad-circle-right]' />,
    },
    {
      keyNames: compact([joinKeys(keyboardMapping.input_player1_b)]),
      message: <span className='icon-[mdi--gamepad-circle-down]' />,
    },
  ]

  const messages: { keyNames: string[]; message: ReactNode }[] = connected
    ? [
        { keyNames: gamepadMapping.$pause.split(/\s+\+\s/u), message: t('emulator.pause') },
        ...(rewindEnabled
          ? [{ keyNames: gamepadMapping.$rewind.split(/\s+\+\s/u), message: t('emulator.rewind') }]
          : []),
        { keyNames: gamepadMapping.$fast_forward.split(/\s+\+\s/u), message: t('emulator.fastForward') },
      ]
    : [
        ...(core === 'mupen64plus_next' ? n64Messages : []),
        ...(core === 'gearcoleco' ? colecoVisionMessages : []),
        ...(isGenesis ? genesisMessages : []),
        ...(isFBNeo ? arcadeMessages : []),
        ...(core === 'mupen64plus_next' || core === 'gearcoleco' || isGenesis || isFBNeo ? [] : genericMessages),
        ...(coinKey ? [{ keyNames: [modifierKeyNames[coinKey] ?? coinKey], message: t('emulator.insertCoin') }] : []),
        { keyNames: compact([keyboardMapping.$pause]), message: t('emulator.pause') },
        ...(rewindEnabled
          ? [{ keyNames: compact([keyboardMapping.input_rewind]), message: t('emulator.rewind') }]
          : []),
        { keyNames: compact([keyboardMapping.input_hold_fast_forward]), message: t('emulator.fastForward') },
      ]

  return messages
    .filter(({ keyNames }) => keyNames.length)
    .map(({ keyNames, message }) => (
      <GameInputMessageItem key={keyNames.join(',')} keyNames={keyNames}>
        {message}
      </GameInputMessageItem>
    ))
}
