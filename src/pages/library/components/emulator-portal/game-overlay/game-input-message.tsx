import { capitalize, compact } from 'es-toolkit'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
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

  const messages: { keyNames: string[]; message: ReactNode }[] = connected
    ? [
        { keyNames: gamepadMapping.$pause.split(/\s+\+\s/u), message: t('emulator.pause') },
        ...(rewindEnabled
          ? [{ keyNames: gamepadMapping.$rewind.split(/\s+\+\s/u), message: t('emulator.rewind') }]
          : []),
        { keyNames: gamepadMapping.$fast_forward.split(/\s+\+\s/u), message: t('emulator.fastForward') },
      ]
    : [
        {
          keyNames: [
            compact([
              keyboardMapping.input_player1_up,
              keyboardMapping.input_player1_down,
              keyboardMapping.input_player1_left,
              keyboardMapping.input_player1_right,
            ])
              .map((key) => ({ down: '↓', left: '←', right: '→', up: '↑' })[key] || capitalize(key))
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
