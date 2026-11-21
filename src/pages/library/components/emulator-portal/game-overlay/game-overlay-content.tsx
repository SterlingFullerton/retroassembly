import { clsx } from 'clsx'
import { noop } from 'es-toolkit'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useRomCover } from '#@/pages/library/hooks/use-rom-cover.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { focus, offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { ControllerButton } from './controller-button.tsx'
import { GameInputMessage } from './game-input-message.tsx'
import { GameOverlayButtons } from './game-overlay-buttons.tsx'
import { GameOverlayDiscs } from './game-overlay-discs.tsx'
import { GameOverlaySavesButton } from './game-overlay-saves-button.tsx'
import { GameOverlaySaves } from './game-overlay-saves.tsx'
import { GameOverlaySettings, GameOverlaySettingsButton } from './game-overlay-settings.tsx'

function handleAnimationComplete(animation) {
  if (animation.opacity === 1) {
    focus('.game-overlay button')
  }
}

export function GameOverlayContent() {
  const { t } = useTranslation()
  const rom = useRom()
  if (!rom) {
    throw new Error('No rom found')
  }
  const { back, hide, page, visible } = useGameOverlay()
  const onSaves = page === 'saves'
  // The saves and the settings are pages of their own, which Back leaves
  const onPage = page !== 'main'
  const goodcodes = getRomGoodcodes(rom)
  const { data: cover } = useRomCover(rom)
  const { emulator, isFullscreen, toggleFullscreen } = useSession()

  useEffect(() => {
    const status = emulator?.getStatus()
    if (visible) {
      // Back from the saves goes to the menu; from the menu it resumes the game
      onCancel(onPage ? back : hide)
    } else if (status === 'running') {
      onCancel(noop)
    } else {
      offCancel()
    }
    return offCancel
  }, [visible, emulator, hide, back, onPage])

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className='game-overlay p-safe flex flex-col bg-black/70 transition-[background-color] duration-300'
          exit={{ opacity: 0, scale: 1.1 }}
          initial={{ opacity: 0, scale: 1.1 }}
          onAnimationComplete={handleAnimationComplete}
          transition={{ duration: 0.2 }}
        >
          <div
            className={clsx(
              'to-text-transparent h-4 w-full shrink-0 bg-linear-to-b from-black',
              onPage ? 'lg:h-8' : 'lg:h-32',
            )}
          />

          <div
            className={clsx(
              'flex w-full flex-1 flex-col overflow-auto px-4 lg:mx-auto lg:w-[min(72rem,calc(100%-4rem))] lg:px-0',
              onPage ? 'gap-3' : 'gap-8',
            )}
          >
            {onSaves ? <GameOverlaySaves /> : null}
            {page === 'settings' ? <GameOverlaySettings /> : null}
            {/* On a phone or tablet the menu sits in the middle of the screen; my-auto, unlike centering, still lets a
                short screen scroll to its top */}
            {onPage ? null : (
              <div className='flex flex-col gap-8 max-lg:my-auto'>
                <div className='game-overlay-title hidden items-center gap-4 lg:flex'>
                  <div className='size-30 shrink-0'>
                    {cover ? (
                      <img alt={goodcodes.rom} className='size-30 object-contain object-center' src={cover.src} />
                    ) : null}
                  </div>
                  <div className='text-3xl font-semibold'>{goodcodes.rom}</div>
                </div>
                <div className='game-overlay-buttons flex flex-col gap-5 lg:flex-row'>
                  <GameOverlayButtons />
                </div>
                <div className='flex shrink-0 flex-col gap-5 lg:flex-row lg:items-center lg:gap-4'>
                  <GameOverlaySettingsButton />
                  <GameOverlayDiscs />
                  <GameOverlaySavesButton />
                  {/* On a computer the button is in the bar at the bottom; a smaller screen has no such bar. Only where
                      the browser can go fullscreen, which an iPhone's can't */}
                  {globalThis.document?.fullscreenEnabled ? (
                    <button
                      className='flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 px-4 text-white transition-colors hover:bg-white/15 lg:hidden'
                      data-sn-enabled
                      data-sn-focus-style={JSON.stringify({
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '24px',
                      })}
                      onClick={toggleFullscreen}
                      type='button'
                    >
                      <span
                        className={clsx(
                          'size-5',
                          isFullscreen ? 'icon-[mdi--fullscreen-exit]' : 'icon-[mdi--fullscreen]',
                        )}
                      />
                      <span className='text-[15px]'>
                        {isFullscreen ? t('emulator.exitFullscreen') : t('emulator.fullscreen')}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div
            className={clsx(
              'h-4 w-full shrink-0 bg-linear-to-b from-transparent to-black text-transparent',
              onPage ? 'lg:h-20' : 'lg:h-32',
            )}
          />

          <div className='absolute bottom-0 hidden h-20 w-full flex-1 items-center justify-end gap-4 px-4 lg:flex'>
            <div className='hidden flex-1 items-center justify-center gap-4 lg:flex'>
              <GameInputMessage />
            </div>
            {isFullscreen ? (
              <ControllerButton onClick={toggleFullscreen} title={t('emulator.exitFullscreen')}>
                <span className='icon-[mdi--fullscreen-exit]' />
              </ControllerButton>
            ) : (
              <ControllerButton onClick={toggleFullscreen} title={t('emulator.fullscreen')}>
                <span className='icon-[mdi--fullscreen]' />
              </ControllerButton>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
