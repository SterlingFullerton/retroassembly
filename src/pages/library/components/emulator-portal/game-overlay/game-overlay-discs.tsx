import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'

// A game on several discs: its discs, beside the volume and in the same style, with the one in the drive filled in.
// Choosing another puts it in; with a gamepad or the keyboard, left and right move between them
export function GameOverlayDiscs() {
  const { t } = useTranslation()
  const { currentDisc, discs, switchToDisc } = useSession()
  const [switching, setSwitching] = useState<number>()

  if (discs.length < 2) {
    return
  }

  async function handleClick(number: number) {
    if (number === currentDisc || switching) {
      return
    }
    setSwitching(number)
    try {
      await switchToDisc(number)
    } finally {
      setSwitching(undefined)
    }
  }

  return (
    <fieldset
      aria-label={t('emulator.changeDisc')}
      className='m-0 flex h-12 w-fit max-w-full min-w-0 shrink-0 items-center gap-2 overflow-x-auto rounded-full border border-solid border-white bg-black/30 pr-1.5 pl-4 text-white'
    >
      <span className='icon-[mdi--disc] size-5 shrink-0' />
      {discs.map(({ number }) => (
        <button
          aria-pressed={number === currentDisc}
          className={clsx(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] transition-colors',
            number === currentDisc ? 'bg-white font-semibold text-black' : 'hover:bg-white/15',
          )}
          data-sn-enabled
          data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: '18px' })}
          key={number}
          onClick={() => handleClick(number)}
          type='button'
        >
          {switching === number ? <span className='icon-[svg-spinners--180-ring] size-4' /> : null}
          {t('emulator.disc', { number })}
        </button>
      ))}
    </fieldset>
  )
}
