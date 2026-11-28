import { clsx } from 'clsx'
import { delay } from 'es-toolkit'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getNASStatePicture, listNASStates, loadNASState, type NASState, saveNASState } from '#@/emulator/nas-games.ts'
import type { PadKeys } from '#@/input/pad.ts'
import { GameInputMessageItem } from '#@/pages/library/components/emulator-portal/game-overlay/game-input-message-item.tsx'
import { PerfOverlaySwitch } from '#@/pages/library/components/emulator-portal/game-overlay/game-overlay-settings.tsx'
import { GameOverlayVolume } from '#@/pages/library/components/emulator-portal/game-overlay/game-overlay-volume.tsx'
import { PadView } from '#@/pages/library/components/emulator-portal/game-overlay/keyboard-pad.tsx'
import {
  FitToWidth,
  focusPauseMenu,
  PauseMenu,
  type PauseMenuAction,
  type PauseMenuPage,
} from '#@/pages/library/components/pause-menu/pause-menu.tsx'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'
import { useNotice } from '#@/pages/library/hooks/use-notice.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import { dateFormatMap } from '#@/utils/isomorphic/i18n.ts'
import { humanizeDate } from '#@/utils/isomorphic/misc.ts'

// The pause menu of a game on the server: the same menu as a game on this device's, which pauses the game for everyone
// in it while it's open. Its save states are the server's own, kept for whoever started the game: the server's
// emulators are other builds than the browser's, and their states don't load in each other

function subscribeToFullscreen(callback: () => void) {
  document.addEventListener('fullscreenchange', callback)
  return () => document.removeEventListener('fullscreenchange', callback)
}

async function toggleFullscreen() {
  try {
    await (document.fullscreenElement ? document.exitFullscreen() : document.body.requestFullscreen())
  } catch {
    // The browser said no
  }
}

/** Fullscreen, as the switch in a game on this device's settings: the whole page goes fullscreen, the game with it */
function FullscreenSwitch() {
  const { t } = useTranslation()
  const fullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => Boolean(document.fullscreenElement),
    () => false,
  )
  if (!globalThis.document?.fullscreenEnabled) {
    return null
  }
  return (
    <div className='flex'>
      <button
        aria-checked={fullscreen}
        className='flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 pr-3 pl-4 text-white transition-colors hover:bg-white/15'
        data-sn-enabled
        data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
        data-testid='nas-fullscreen'
        onClick={toggleFullscreen}
        role='switch'
        type='button'
      >
        <span className={clsx('size-5', fullscreen ? 'icon-[mdi--fullscreen-exit]' : 'icon-[mdi--fullscreen]')} />
        <span className='text-[15px]'>{t('emulator.fullscreen')}</span>
        <span
          className={clsx(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            fullscreen ? 'bg-white' : 'bg-white/25',
          )}
        >
          <span
            className={clsx(
              'absolute top-0.5 size-4 rounded-full transition-all',
              fullscreen ? 'left-4.5 bg-black' : 'left-0.5 bg-white',
            )}
          />
        </span>
      </button>
    </div>
  )
}

/** The server's save states as pictures: choosing one loads it and resumes */
function ServerStates({
  code,
  onLoaded,
  states,
}: Readonly<{ code: string; onLoaded: () => void; states: NASState[] | undefined }>) {
  const { i18n, t } = useTranslation()
  const { preference } = usePreference()
  const [failed, setFailed] = useState(false)
  // Saved times as the game's own snapshots show them: in the app's language and date format
  const dateFormat =
    preference.ui.dateFormat === 'auto'
      ? dateFormatMap[i18n.language as keyof typeof dateFormatMap]
      : preference.ui.dateFormat

  async function load(state: NASState) {
    setFailed(false)
    try {
      await loadNASState(code, state.id)
      onLoaded()
    } catch {
      setFailed(true)
    }
  }

  if (states === undefined) {
    return <span className='icon-[svg-spinners--180-ring] size-6 self-center' />
  }
  return (
    <div className='flex flex-col gap-3' data-testid='nas-states'>
      {failed ? (
        <p className='text-sm text-[#ffc46b]' role='alert'>
          {t('error.loadSnapshotFailed')}
        </p>
      ) : null}
      {states.length === 0 ? (
        <div className='flex items-center justify-center gap-2 py-6 text-sm text-neutral-400'>
          <span className='icon-[mdi--database-outline] text-xl' />
          {t('empty.noSavedStates')}
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-3'>
          {states.map((state) => (
            <button
              className='flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none hover:bg-white/10 focus:bg-(--accent-9)'
              data-sn-enabled
              data-sn-focus-style={JSON.stringify({ opacity: 0 })}
              key={state.id}
              onClick={() => load(state)}
              type='button'
            >
              <img
                alt=''
                className='aspect-4/3 w-full rounded-md bg-black object-contain'
                src={getNASStatePicture(code, state.id)}
              />
              <span className='px-1 text-xs'>{humanizeDate(state.created, dateFormat)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ServerPauseMenu({
  code,
  friendCode,
  linked,
  onClose,
  onEnd,
  onLeave,
  onRestart,
  pad,
  players,
  startedHere,
  title,
}: Readonly<{
  code: string
  /** On the starter's console of a linked pair, the code that joins the friend's console */
  friendCode?: string
  /** A console of a linked pair: two consoles can't be put back in step, so there are no snapshots */
  linked: boolean
  onClose: () => void
  /** Ends the game for everyone in it */
  onEnd: () => Promise<void>
  onLeave: () => Promise<void>
  onRestart: () => void
  /** The console's controller with the keys that play it, drawn in Controls on a computer */
  pad?: PadKeys
  players?: number
  startedHere: boolean
  title: string
}>) {
  const { t } = useTranslation()
  const notify = useNotice()
  const keyboard = useKeyboardMapping()
  const { connected } = useGamepads()
  // An exit under way, which a second press doesn't start again
  const exiting = useRef(false)
  const [page, setPage] = useState<PauseMenuPage>('main')
  const [states, setStates] = useState<NASState[]>()

  async function reloadStates() {
    try {
      setStates(await listNASStates(code))
    } catch {
      setStates([])
    }
  }

  // The saves are counted as the menu opens, and the focus starts on Resume
  useEffect(() => {
    let stopped = false
    async function count() {
      if (linked) {
        return
      }
      let found: NASState[] = []
      try {
        found = await listNASStates(code)
      } catch {
        // None to show
      }
      if (!stopped) {
        setStates(found)
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- count() answers for its own failures
    count()
    focusPauseMenu('main')
    return () => {
      stopped = true
    }
  }, [code, linked])

  async function open(next: Exclude<PauseMenuPage, 'main'>) {
    setPage(next)
    await delay(0)
    focusPauseMenu(next)
  }

  async function back() {
    const from = page
    setPage('main')
    await delay(0)
    focusPauseMenu('main', from)
  }

  // A gamepad's back button goes back from a page, and closes the menu from the menu
  useEffect(() => {
    onCancel(page === 'main' ? onClose : back)
    return offCancel
  })

  async function save() {
    await saveNASState(code)
    await reloadStates()
  }

  // Saved first, as a game on this device is: a snapshot that fails is said, and the game goes on, to be ended without
  // saving from the same page if the player chooses
  async function saveAndEnd() {
    if (exiting.current) {
      return
    }
    exiting.current = true
    try {
      await saveNASState(code)
    } catch {
      exiting.current = false
      notify(t('emulator.snapshotFailed'))
      return
    }
    try {
      await onEnd()
    } finally {
      exiting.current = false
    }
  }

  async function end() {
    if (exiting.current) {
      return
    }
    exiting.current = true
    try {
      await onEnd()
    } finally {
      exiting.current = false
    }
  }

  const exitActions: PauseMenuAction[] = startedHere
    ? [
        ...(linked
          ? []
          : [
              {
                icon: 'icon-[mdi--content-save-move]',
                label: t('pauseMenu.saveAndExit'),
                onClick: saveAndEnd,
                testId: 'pause-save-exit',
              },
            ]),
        {
          icon: 'icon-[mdi--exit-to-app]',
          // A linked game has no snapshot to leave unsaved: its own save is kept all the same
          label: linked ? t('common.exit') : t('pauseMenu.exitWithoutSaving'),
          onClick: end,
          testId: 'pause-exit-now',
        },
        {
          apart: true,
          icon: 'icon-[mdi--restart]',
          label: t('pauseMenu.restart'),
          onClick: onRestart,
          testId: 'pause-restart',
        },
      ]
    : [
        { icon: 'icon-[mdi--exit-to-app]', label: t('pauseMenu.leave'), onClick: onLeave, testId: 'pause-leave' },
        {
          apart: true,
          icon: 'icon-[mdi--restart]',
          label: t('pauseMenu.restart'),
          onClick: onRestart,
          testId: 'pause-restart',
        },
      ]

  return (
    <div className='game-overlay absolute inset-0'>
      <PauseMenu
        exitActions={exitActions}
        onBack={back}
        onOpen={open}
        onResume={onClose}
        onSave={save}
        page={page}
        snapshots={!linked}
        pages={{
          controls: (
            <>
              <div className='flex flex-wrap gap-x-4 gap-y-2 text-sm'>
                <GameInputMessageItem keyNames={[keyboard.$pause]}>{t('emulator.pause')}</GameInputMessageItem>
              </div>
              {pad && !connected ? (
                <div className='hidden lg:block'>
                  <FitToWidth>
                    <PadView pad={pad} />
                  </FitToWidth>
                </div>
              ) : null}
            </>
          ),
          load: <ServerStates code={code} onLoaded={onClose} states={states} />,
          settings: (
            <div className='flex w-full flex-col gap-6'>
              <section className='flex flex-col gap-2'>
                <h3 className='text-sm font-semibold tracking-wide text-white/70 uppercase'>{t('emulator.volume')}</h3>
                <div className='flex'>
                  <GameOverlayVolume />
                </div>
              </section>
              <PerfOverlaySwitch />
              <FullscreenSwitch />
            </div>
          ),
          together: (
            <div className='flex flex-col gap-3' data-testid='server-together'>
              <div className='font-mono text-3xl font-semibold tracking-[0.3em]'>{friendCode ?? code}</div>
              <p className='text-sm text-white/70'>
                {friendCode ? t('pauseMenu.friendJoinHint') : t('pauseMenu.joinHint')}
              </p>
              {players && players > 1 ? <p className='text-sm'>{t('pauseMenu.players', { count: players })}</p> : null}
            </div>
          ),
        }}
        players={players}
        saveCount={states?.length}
        title={title}
        where='server'
      />
    </div>
  )
}
