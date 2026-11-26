import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { GameOverlayButton } from './game-overlay-button.tsx'
import { GameOverlayPlayTogether } from './game-overlay-play-together.tsx'
import { GameOverlayShader } from './game-overlay-shader.tsx'
import { GameOverlayVolume } from './game-overlay-volume.tsx'
import { PerfDetails } from './perf-details.tsx'

// The pause menu's settings, opened from its Settings button beside the saves'. The menu itself keeps what's
// done mid-game; how the game sounds and looks is here. Back, the pause key or the gamepad's back button return to the
// menu

/** The pause menu's way to its settings, in the style of the saves' button beside it */
export function GameOverlaySettingsButton() {
  const { t } = useTranslation()
  const { openSettings } = useGameOverlay()

  return (
    <button
      className='game-overlay-settings flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 pr-3 pl-4 text-white transition-colors hover:bg-white/15'
      data-sn-enabled
      data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
      onClick={openSettings}
      type='button'
    >
      <span className='icon-[mdi--cog] size-5' />
      <span className='text-[15px]'>{t('nav.settings')}</span>
      <span className='icon-[mdi--chevron-right] size-5' />
    </button>
  )
}

/** The performance overlay's switch, in the style of the menu's buttons: this device's own, like the volume */
function GameOverlayPerf() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePerfOverlay()

  return (
    <section className='game-overlay-peek-dim flex flex-col gap-2'>
      <div className='flex'>
        <button
          aria-checked={enabled}
          className='flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 pr-3 pl-4 text-white transition-colors hover:bg-white/15'
          data-sn-enabled
          data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
          onClick={() => setEnabled(!enabled)}
          role='switch'
          type='button'
        >
          <span className='icon-[mdi--speedometer] size-5' />
          <span className='text-[15px]'>{t('settings.performanceOverlay')}</span>
          <span
            className={clsx(
              'relative h-5 w-9 shrink-0 rounded-full transition-colors',
              enabled ? 'bg-white' : 'bg-white/25',
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 size-4 rounded-full transition-all',
                enabled ? 'left-4.5 bg-black' : 'left-0.5 bg-white',
              )}
            />
          </span>
        </button>
      </div>
      {enabled ? <PerfDetails /> : null}
    </section>
  )
}

/** The settings page: the volume, the shader, which changes on the paused game as it's picked, and the performance overlay */
export function GameOverlaySettings() {
  const { t } = useTranslation()
  const { back } = useGameOverlay()

  return (
    <>
      <div className='game-overlay-title flex shrink-0 items-center gap-4'>
        <div className='game-overlay-back'>
          <GameOverlayButton onClick={back}>
            <span className='icon-[mdi--chevron-left] size-5' />
            {t('common.back')}
          </GameOverlayButton>
        </div>
        <h2 className='text-2xl font-semibold'>{t('nav.settings')}</h2>
      </div>
      <div className='flex w-full max-w-2xl flex-col gap-6 [@media(max-height:420px)]:gap-4'>
        <section className='game-overlay-peek-dim flex flex-col gap-2'>
          <h3 className='text-sm font-semibold tracking-wide text-white/70 uppercase'>{t('emulator.volume')}</h3>
          <div className='flex'>
            <GameOverlayVolume />
          </div>
        </section>
        <GameOverlayShader />
        <GameOverlayPlayTogether />
        <GameOverlayPerf />
      </div>
    </>
  )
}
