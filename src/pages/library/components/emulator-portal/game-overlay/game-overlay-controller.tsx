import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useEmulator } from '../hooks/use-emulator.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { useMouseIdle } from '../hooks/use-mouse-idle.ts'
import { ControllerButton } from './controller-button.tsx'
import { GameInputMessage } from './game-input-message.tsx'

export function GameOverlayController() {
  const { t } = useTranslation()
  const rom = useRom()
  if (!rom) {
    throw new Error('No rom found')
  }
  const idle = useMouseIdle(3000)
  const { hide, show, visible } = useGameOverlay()
  const { emulator, exit, isFullscreen, toggleFullscreen } = useEmulator()
  const [launched] = useEmulatorLaunched()

  async function handleClickExit() {
    await Promise.all([hide(), exit({ reloadAfterExit: true })])
  }

  async function handleClickPause() {
    await show()
  }

  const controllerVisible = launched && !idle && !visible

  // On DS the mouse is the stylus, so it always shows there, though the DS emulator hides it. Elsewhere it shows while
  // the mouse moves and hides once it's still, like the bar. Classes are used because the emulator keeps resetting the
  // canvas's own cursor style, and an important rule wins over it
  const showCursor = rom.platform === 'nds' || !idle
  useEffect(() => {
    const canvas = emulator?.getCanvas()
    canvas?.classList.toggle('cursor-default!', launched && showCursor)
    canvas?.classList.toggle('cursor-none!', launched && !showCursor)
  }, [emulator, launched, showCursor])

  return (
    <AnimatePresence>
      {controllerVisible ? (
        <motion.div
          animate={{ opacity: 1 }}
          // Covers the whole game, so only its buttons take clicks: the game gets the rest, which on DS is its touchscreen
          className='pointer-events-none! hidden flex-col justify-between lg:flex [&_button]:pointer-events-auto'
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          role='toolbar'
          transition={{ duration: 0.2 }}
        >
          <div>
            <div className='flex h-20 w-full items-center justify-end bg-linear-to-b from-black/70 to-black/40 px-4'>
              <ControllerButton onClick={handleClickExit} title={t('common.exit')}>
                <span className='icon-[mdi--close]' />
              </ControllerButton>
            </div>
            <div className='h-20 bg-linear-to-b from-black/40 to-transparent' />
          </div>

          <div>
            <div className='h-20 bg-linear-to-b from-transparent to-black/40' />
            <div className='flex h-20 w-full items-center bg-linear-to-b from-black/40 to-black/70 px-4'>
              <ControllerButton onClick={handleClickPause} title={t('emulator.pause')}>
                <span className='icon-[mdi--pause]' />
              </ControllerButton>
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
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
