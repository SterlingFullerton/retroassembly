import { noop } from 'es-toolkit'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import {
  FitToWidth,
  focusPauseMenu,
  PauseMenu,
  type PauseMenuAction,
} from '#@/pages/library/components/pause-menu/pause-menu.tsx'
import { useNotice } from '#@/pages/library/hooks/use-notice.ts'
import { useSharing } from '#@/pages/library/hooks/use-play-together.ts'
import { useRomCover } from '#@/pages/library/hooks/use-rom-cover.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { useGameStates } from '../hooks/use-game-states.ts'
import { GameInputMessage } from './game-input-message.tsx'
import { GameOverlayPlayTogether } from './game-overlay-play-together.tsx'
import { GameOverlaySettings } from './game-overlay-settings.tsx'
import { GameStates } from './game-states.tsx'
import { KeyboardPad } from './keyboard-pad.tsx'
import { LoadExternalState } from './load-external-state.tsx'

function handleAnimationComplete(animation) {
  if (animation.opacity === 1) {
    focusPauseMenu('main')
  }
}

/** The keys the emulator answers to, and the console's controller drawn as the keys that play it */
function GameOverlayControls() {
  return (
    <>
      <div className='flex flex-wrap gap-x-4 gap-y-2 text-sm'>
        <GameInputMessage />
      </div>
      <FitToWidth>
        <KeyboardPad />
      </FitToWidth>
    </>
  )
}

/** The pause menu of a game played on this device */
export function GameOverlayContent() {
  const { t } = useTranslation()
  const notify = useNotice()
  const rom = useRom()
  if (!rom) {
    throw new Error('No rom found')
  }
  const { back, hide, isPending, open, page, setIsPending, visible } = useGameOverlay()
  const goodcodes = getRomGoodcodes(rom)
  const { data: cover } = useRomCover(rom)
  const { emulator, exit } = useSession()
  const { saveManualState, states } = useGameStates()
  const sharing = useSharing()
  const onPage = page !== 'main'

  useEffect(() => {
    const status = emulator?.getStatus()
    if (visible) {
      // Back from a page goes to the menu; from the menu it resumes the game
      onCancel(onPage ? back : hide)
    } else if (status === 'running') {
      onCancel(noop)
    } else {
      offCancel()
    }
    return offCancel
  }, [visible, emulator, hide, back, onPage])

  // A failure is the menu's to say, on the Save item
  async function save() {
    if (isPending) {
      return
    }
    setIsPending(true)
    try {
      await saveManualState()
    } finally {
      setIsPending(false)
    }
  }

  async function exitGame() {
    await hide()
    await exit({ reloadAfterExit: true })
  }

  async function saveAndExit() {
    if (isPending) {
      return
    }
    setIsPending(true)
    try {
      await saveManualState()
    } catch {
      setIsPending(false)
      notify(t('emulator.snapshotFailed'))
      return
    }
    try {
      await hide()
      await exit({ reloadAfterExit: true })
    } finally {
      setIsPending(false)
    }
  }

  async function restart() {
    emulator?.restart()
    await hide()
  }

  const exitActions: PauseMenuAction[] = [
    {
      icon: 'icon-[mdi--content-save-move]',
      label: t('pauseMenu.saveAndExit'),
      onClick: saveAndExit,
      testId: 'pause-save-exit',
    },
    {
      icon: 'icon-[mdi--exit-to-app]',
      label: t('pauseMenu.exitWithoutSaving'),
      onClick: exitGame,
      testId: 'pause-exit-now',
    },
    {
      apart: true,
      icon: 'icon-[mdi--restart]',
      label: t('pauseMenu.restart'),
      onClick: restart,
      testId: 'pause-restart',
    },
  ]

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          animate={{ opacity: 1 }}
          className='game-overlay'
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onAnimationComplete={handleAnimationComplete}
          transition={{ duration: 0.15 }}
        >
          <PauseMenu
            cover={cover?.src}
            exitActions={exitActions}
            onBack={back}
            onOpen={open}
            onResume={hide}
            onSave={save}
            page={page}
            pages={{
              controls: <GameOverlayControls />,
              load: (
                <>
                  <GameStates />
                  <div className='flex'>
                    <LoadExternalState />
                  </div>
                </>
              ),
              settings: <GameOverlaySettings />,
              together: emulator ? <GameOverlayPlayTogether /> : undefined,
            }}
            players={sharing.stage === 'connected' ? 2 : undefined}
            saveCount={states.length}
            title={goodcodes.rom}
            where='device'
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
