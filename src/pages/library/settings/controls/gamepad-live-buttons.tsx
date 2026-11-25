import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isValveController } from '#@/pages/library/hooks/use-confirm-button-style.ts'

// The buttons of a standard controller, in the order browsers number them
const names = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home']

/**
 * Each of the controller's buttons, lit while it's held: a quick check that every button reaches the app, such as on a
 * Steam Deck, where Steam can keep some to itself
 */
export function GamepadLiveButtons({ index, id }: Readonly<{ id: string; index: number }>) {
  const { t } = useTranslation()
  const [pressed, setPressed] = useState<boolean[]>([])

  useEffect(() => {
    let frame = 0
    function read() {
      const gamepad = navigator.getGamepads?.()[index]
      const now = gamepad ? gamepad.buttons.map((button) => button.pressed) : []
      setPressed((before) => (before.join(',') === now.join(',') ? before : now))
      frame = requestAnimationFrame(read)
    }
    frame = requestAnimationFrame(read)
    return () => cancelAnimationFrame(frame)
  }, [index])

  return (
    <div className='px-4 pt-3'>
      <div className='mb-2 text-sm opacity-80'>
        {isValveController({ id }) ? t('gamepad.valveDetected') : null} {t('gamepad.liveCheck')}
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {names.map((name, button) => (
          <span
            className={clsx(
              'min-w-9 rounded border px-2 py-1 text-center text-xs font-semibold transition-colors',
              pressed[button] ? 'border-(--accent-9) bg-(--accent-9) text-white' : 'border-(--gray-6) text-(--gray-11)',
            )}
            key={name}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}
