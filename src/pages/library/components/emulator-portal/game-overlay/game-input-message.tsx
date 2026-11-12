import { capitalize, compact } from 'es-toolkit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getN64Keyboard } from '#@/pages/library/utils/core-keyboard.ts'
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
  return arrowNames[key] ?? modifierKeyNames[key] ?? capitalize(key)
}

// Several keys shown as one, such as the four arrows
function joinKeys(...keys: (string | undefined)[]) {
  return compact(keys)
    .map((key) => keyName(key))
    .join(' ')
}

// The N64's buttons named and coloured as on its controller
function N64Button({ children, color }: Readonly<{ children: ReactNode; color?: string }>) {
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
  const { keyboard: keyboardMapping } = useInputMapping()
  const { preference } = usePreference()
  const rom = useRom()
  const rewindEnabled = rom ? preference.emulator.platform[rom.platform].rewindEnabled : true
  // Arcade games take a coin with Select, which the hint otherwise doesn't mention
  const coinKey = rom?.platform === 'arcade' ? keyboardMapping.input_player1_select : undefined
  const core = rom ? preference.emulator.platform[rom.platform]?.core : undefined
  const n64Keys = getN64Keyboard(keyboardMapping).keys

  // On the N64 the keys play its controller: the RetroPad's B, Y, L2 and right stick are its A, B, Z and C buttons (its
  // emulator ignores the RetroPad's X and A), and the stick and D-pad have keys of their own
  const n64Messages: { keyNames: string[]; message: ReactNode }[] = [
    { keyNames: compact([joinKeys(...n64Keys.stick)]), message: <N64Button>Stick</N64Button> },
    { keyNames: compact([joinKeys(...n64Keys.dpad)]), message: <N64Button>D-pad</N64Button> },
    { keyNames: compact([keyboardMapping.input_player1_b]), message: <N64Button color='#6f9bff'>A</N64Button> },
    { keyNames: compact([keyboardMapping.input_player1_y]), message: <N64Button color='#4fcf68'>B</N64Button> },
    { keyNames: compact([joinKeys(...n64Keys.c)]), message: <N64Button color='#f2c21a'>C</N64Button> },
    { keyNames: compact([n64Keys.z]), message: <N64Button>Z</N64Button> },
    { keyNames: compact([keyboardMapping.input_player1_l1]), message: <N64Button>L</N64Button> },
    { keyNames: compact([keyboardMapping.input_player1_r1]), message: <N64Button>R</N64Button> },
    {
      keyNames: compact([keyboardMapping.input_player1_start]),
      message: <N64Button color='#ff6b5e'>Start</N64Button>,
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
      keyNames: compact([keyboardMapping.input_player1_y]),
      message: <span className='icon-[mdi--gamepad-circle-left]' />,
    },
    {
      keyNames: compact([keyboardMapping.input_player1_a]),
      message: <span className='icon-[mdi--gamepad-circle-right]' />,
    },
    {
      keyNames: compact([keyboardMapping.input_player1_b]),
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
        ...(core === 'mupen64plus_next' ? [] : genericMessages),
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
