import { useTranslation } from 'react-i18next'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { GameOverlayButton } from './game-overlay-button.tsx'
import { GameOverlayShader } from './game-overlay-shader.tsx'
import { GameOverlayVolume } from './game-overlay-volume.tsx'

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

/** The settings page: the volume, and the shader, which changes on the paused game as it's picked */
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
      </div>
    </>
  )
}
