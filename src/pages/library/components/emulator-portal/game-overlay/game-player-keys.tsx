import { Kbd } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useEmulatorLaunched, useShowGameOverlayContent, useShowPlayerKeys } from '#@/pages/library/atoms.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'

const keyLabels: Record<string, string> = {
  down: '↓',
  enter: 'Enter',
  lalt: 'Left Alt',
  lctrl: 'Left Ctrl',
  left: '←',
  lshift: 'Left Shift',
  ralt: 'Right Alt',
  rctrl: 'Right Ctrl',
  right: '→',
  rshift: 'Right Shift',
  space: 'Space',
  up: '↑',
}

function getKeyLabel(key?: string) {
  if (!key || key === 'nul') {
    return ''
  }
  return keyLabels[key] ?? (key.startsWith('num') ? key.slice(3) : key.toUpperCase())
}

function Keys({ keys }: Readonly<{ keys: (string | undefined)[] }>) {
  const labels = keys.map((key) => getKeyLabel(key)).filter(Boolean)
  if (labels.length === 0) {
    return <span className='opacity-40'>–</span>
  }
  return (
    <span className='flex gap-1'>
      {labels.map((label) => (
        <Kbd key={label} size='1'>
          {label}
        </Kbd>
      ))}
    </span>
  )
}

// Player 1's keyboard keys, kept on screen during play when turned on from the pause menu. Player 2 plays on a
// second controller
export function GamePlayerKeys() {
  const { t } = useTranslation()
  const [showPlayerKeys] = useShowPlayerKeys()
  const [launched] = useEmulatorLaunched()
  const [pauseMenuVisible] = useShowGameOverlayContent()
  const { preference } = usePreference()
  const rom = useRom()

  // Hidden behind the pause menu, which has its own layout
  if (!showPlayerKeys || !launched || pauseMenuVisible) {
    return
  }

  const keys = preference.input.keyboardMapping
  const rows = [
    {
      keys: [keys.input_player1_up, keys.input_player1_down, keys.input_player1_left, keys.input_player1_right],
      label: <span className='icon-[mdi--gamepad]' />,
    },
    { keys: [keys.input_player1_y], label: 'Y' },
    { keys: [keys.input_player1_x], label: 'X' },
    { keys: [keys.input_player1_b], label: 'B' },
    { keys: [keys.input_player1_a], label: 'A' },
    { keys: [keys.input_player1_l1], label: 'L' },
    { keys: [keys.input_player1_r1], label: 'R' },
    { keys: [keys.input_player1_start], label: 'Start' },
    { keys: [keys.input_player1_select], label: rom?.platform === 'arcade' ? t('emulator.coin') : 'Select' },
  ]

  return (
    <div className='pointer-events-none! hidden lg:block'>
      <div className='absolute top-4 left-4 rounded-lg bg-black/70 p-3 text-xs text-white/85 backdrop-blur-sm'>
        <div className='grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1.5'>
          {rows.map((row, index) => (
            <div className='contents' key={index}>
              <span className='font-semibold opacity-70'>{row.label}</span>
              <Keys keys={row.keys} />
            </div>
          ))}
        </div>
        <div className='mt-2.5 flex items-center gap-1.5 opacity-70'>
          <span className='icon-[mdi--controller]' />
          {t('emulator.player2Controller')}
        </div>
      </div>
    </div>
  )
}
