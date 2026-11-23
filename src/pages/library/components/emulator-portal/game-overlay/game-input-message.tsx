import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConsole } from '#@/consoles/registry.ts'
import { getKeyboardHints, type HintLabel } from '#@/input/hints.ts'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { GameInputMessageItem } from './game-input-message-item.tsx'

// A console's buttons named, and coloured, as on its controller
function ConsoleButton({ children, color }: Readonly<{ children: ReactNode; color?: string }>) {
  return (
    <span className='font-bold' style={color ? { color } : undefined}>
      {children}
    </span>
  )
}

// Written out in full so the stylesheet includes them
const iconClasses: Record<string, string> = {
  'mdi--gamepad': 'icon-[mdi--gamepad]',
  'mdi--gamepad-circle-down': 'icon-[mdi--gamepad-circle-down]',
  'mdi--gamepad-circle-left': 'icon-[mdi--gamepad-circle-left]',
  'mdi--gamepad-circle-right': 'icon-[mdi--gamepad-circle-right]',
  'mdi--gamepad-circle-up': 'icon-[mdi--gamepad-circle-up]',
}

function HintMessage({ label }: Readonly<{ label: HintLabel }>) {
  const { t } = useTranslation()
  if ('button' in label) {
    return <ConsoleButton color={label.color}>{label.button}</ConsoleButton>
  }
  if ('icon' in label) {
    return <span className={iconClasses[label.icon]} />
  }
  return t(label.text)
}

export function GameInputMessage() {
  const { t } = useTranslation()
  const { connected } = useGamepads()
  const gamepadMapping = useGamepadMapping()
  const { keyboard: sharedKeyboardMapping } = useInputMapping()
  const { preference } = usePreference()
  const rom = useRom()
  const rewindEnabled = rom ? preference.emulator.platform[rom.platform].rewindEnabled : true
  const core = rom ? preference.emulator.platform[rom.platform]?.core : undefined

  if (connected) {
    const messages = [
      { keyNames: gamepadMapping.$pause.split(/\s+\+\s/u), message: t('emulator.pause') },
      ...(rewindEnabled ? [{ keyNames: gamepadMapping.$rewind.split(/\s+\+\s/u), message: t('emulator.rewind') }] : []),
      { keyNames: gamepadMapping.$fast_forward.split(/\s+\+\s/u), message: t('emulator.fastForward') },
    ].filter(({ keyNames }) => keyNames.length)
    return messages.map(({ keyNames, message }) => (
      <GameInputMessageItem key={keyNames.join(',')} keyNames={keyNames}>
        {message}
      </GameInputMessageItem>
    ))
  }

  // The keys the emulator itself answers to; the console's buttons are on the pause menu's picture of its controller
  const hints = rom && core ? getKeyboardHints(resolveConsole(rom.platform, core), sharedKeyboardMapping) : []
  return hints
    .filter(({ message }) => 'text' in message && message.text !== 'emulator.insertCoin')
    .filter(({ message }) => rewindEnabled || !('text' in message && message.text === 'emulator.rewind'))
    .map(({ keyNames, message }) => (
      <GameInputMessageItem key={keyNames.join(',')} keyNames={keyNames}>
        <HintMessage label={message} />
      </GameInputMessageItem>
    ))
}
