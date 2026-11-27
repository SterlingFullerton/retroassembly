import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { GameOverlayDiscs } from './game-overlay-discs.tsx'
import { GameOverlayShader } from './game-overlay-shader.tsx'
import { GameOverlayVolume } from './game-overlay-volume.tsx'
import { PerfDetails } from './perf-details.tsx'

// The pause menu's settings page: how the game sounds and looks on this device. Back, the pause key or the gamepad's
// back button return to the menu

/** The performance overlay's switch, in the style of the menu's buttons: this device's own, like the volume */
export function PerfOverlaySwitch() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePerfOverlay()

  return (
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
  )
}

/** The switch, and the game's numbers under it while it's on */
function GameOverlayPerf() {
  const [enabled] = usePerfOverlay()

  return (
    <section className='game-overlay-peek-dim flex flex-col gap-2'>
      <PerfOverlaySwitch />
      {enabled ? <PerfDetails /> : null}
    </section>
  )
}

/** A switch in the style of the performance overlay's, for going fullscreen where the browser can */
function GameOverlayFullscreen() {
  const { t } = useTranslation()
  const { isFullscreen, toggleFullscreen } = useSession()
  if (!globalThis.document?.fullscreenEnabled) {
    return null
  }
  return (
    <section className='game-overlay-peek-dim flex'>
      <button
        aria-checked={isFullscreen}
        className='flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 pr-3 pl-4 text-white transition-colors hover:bg-white/15'
        data-sn-enabled
        data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
        onClick={toggleFullscreen}
        role='switch'
        type='button'
      >
        <span className={clsx('size-5', isFullscreen ? 'icon-[mdi--fullscreen-exit]' : 'icon-[mdi--fullscreen]')} />
        <span className='text-[15px]'>{t('emulator.fullscreen')}</span>
        <span
          className={clsx(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            isFullscreen ? 'bg-white' : 'bg-white/25',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 size-4 rounded-full transition-all',
              isFullscreen ? 'left-4.5 bg-black' : 'left-0.5 bg-white',
            )}
          />
        </span>
      </button>
    </section>
  )
}

/** The settings page: the volume, the shader, which changes on the paused game as it's picked, the disc, the
 * performance overlay and fullscreen */
export function GameOverlaySettings() {
  const { t } = useTranslation()

  return (
    <div className='flex w-full flex-col gap-6 [@media(max-height:420px)]:gap-4'>
      <section className='game-overlay-peek-dim flex flex-col gap-2'>
        <h3 className='text-sm font-semibold tracking-wide text-white/70 uppercase'>{t('emulator.volume')}</h3>
        <div className='flex'>
          <GameOverlayVolume />
        </div>
      </section>
      <GameOverlayShader />
      <GameOverlayDiscs />
      <GameOverlayPerf />
      <GameOverlayFullscreen />
    </div>
  )
}
