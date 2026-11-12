import { Kbd } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useEmulatorLaunched, useShowPlayerKeys } from '#@/pages/library/atoms.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getPlayer2KeyboardMapping } from '#@/pages/library/utils/player2-keys.ts'

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

// Both players' keyboard keys, kept on screen during play when turned on from the pause menu
export function GamePlayerKeys() {
  const { t } = useTranslation()
  const [showPlayerKeys] = useShowPlayerKeys()
  const [launched] = useEmulatorLaunched()
  const { preference } = usePreference()
  const rom = useRom()

  if (!showPlayerKeys || !launched) {
    return
  }

  const p1 = preference.input.keyboardMapping
  const p2 = getPlayer2KeyboardMapping(p1)
  const rows = [
    {
      label: <span className='icon-[mdi--gamepad]' />,
      p1: [p1.input_player1_up, p1.input_player1_down, p1.input_player1_left, p1.input_player1_right],
      p2: [p2.input_player2_up, p2.input_player2_down, p2.input_player2_left, p2.input_player2_right],
    },
    { label: 'Y', p1: [p1.input_player1_y], p2: [p2.input_player2_y] },
    { label: 'X', p1: [p1.input_player1_x], p2: [p2.input_player2_x] },
    { label: 'B', p1: [p1.input_player1_b], p2: [p2.input_player2_b] },
    { label: 'A', p1: [p1.input_player1_a], p2: [p2.input_player2_a] },
    { label: 'L', p1: [p1.input_player1_l1], p2: [p2.input_player2_l] },
    { label: 'R', p1: [p1.input_player1_r1], p2: [p2.input_player2_r] },
    { label: 'Start', p1: [p1.input_player1_start], p2: [p2.input_player2_start] },
    {
      label: rom?.platform === 'arcade' ? t('emulator.coin') : 'Select',
      p1: [p1.input_player1_select],
      p2: [p2.input_player2_select],
    },
  ]

  return (
    <div className='pointer-events-none! hidden lg:block'>
      <div className='absolute top-4 left-4 rounded-lg bg-black/70 p-3 text-xs text-white/85 backdrop-blur-sm'>
        <div className='grid grid-cols-[auto_auto_auto] items-center gap-x-4 gap-y-1.5'>
          <span />
          <span className='font-semibold'>P1</span>
          <span className='font-semibold'>P2</span>
          {rows.map((row, index) => (
            <div className='contents' key={index}>
              <span className='font-semibold opacity-70'>{row.label}</span>
              <Keys keys={row.p1} />
              <Keys keys={row.p2} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
