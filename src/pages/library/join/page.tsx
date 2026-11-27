import { clsx } from 'clsx'
import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { getPictureLayout, type PictureArea } from '#@/emulator/game-picture.ts'
import { isNASCode, stopNASGame } from '#@/emulator/nas-games.ts'
import { connectGuestOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { findInvitation, getOwnAddress, listOpenGames, type OpenGame } from '#@/emulator/play-together-signal.ts'
import { encodePadState, joinGame, type NASCommand, type NASNumbers } from '#@/emulator/play-together.ts'
import { getKeyButtons, mergePads } from '#@/input/guest-pad.ts'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { TestSessionProvider } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { ConsoleControls } from '#@/pages/library/components/emulator-portal/game-overlay/console-controls.tsx'
import {
  readoutBox,
  Row,
  Section,
  StreamSection,
} from '#@/pages/library/components/emulator-portal/game-overlay/perf-readout.tsx'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { useStreamStats } from '#@/pages/library/hooks/use-stream-stats.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'
import { routes } from '#@/pages/routes.ts'
import { NASMenu } from './nas-menu.tsx'

// A guest's side of a game played together: the host's game, as a picture and sound sent from their device, with this
// device's keys, controller or on-screen controls playing as the next player. An experiment, with its words in English
// until it's decided whether to keep it.
//
// A game on the NAS is played here too, by everyone in it: whoever starts it from its page arrives with its code, and
// joins first. Such a game has a pause menu, which pauses it for everyone in it
//
// The games being shared are listed, to join with one press: a code is awkward to type with a controller. A host who
// asked for a code is joined by typing it instead

// The controller is sent when it changes, and again this often in case a message was lost on the way
const resendEvery = 100
const sendEvery = 16
// How often the list of games is looked at again
const listEvery = 3000
// How long the two devices are given to reach each other before it's called off
const connectWithin = 20_000

// Choosing a game, reaching its host, playing, or one of the two ways it stops
type Stage = 'choosing' | 'connecting' | 'ended' | 'playing' | 'unreachable'

type Found = Awaited<ReturnType<typeof findInvitation>>

const codeLength = 6
const pill =
  'flex min-h-12 items-center gap-3 rounded-full border border-solid border-white px-5 py-2 hover:bg-white/15 disabled:opacity-50'
const focusStyle = JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })

/** The first real controller connected to this device */
function getController() {
  return [...(navigator.getGamepads?.() ?? [])].find((gamepad) => gamepad?.connected)
}

/** A game on the NAS's numbers, as a section of the performance overlay */
function NASSection({ numbers }: Readonly<{ numbers: NASNumbers }>) {
  return (
    <Section title='Game, on the NAS'>
      <Row label='frame rate'>{numbers.paused ? 'paused' : `${numbers.fps} fps`}</Row>
      <Row label='run, avg'>{numbers.runAvg.toFixed(1)} ms</Row>
      <Row label='run, max'>{numbers.runMax.toFixed(1)} ms</Row>
      <Row label='encode, avg'>{numbers.encodeAvg.toFixed(1)} ms</Row>
      <Row label='players'>{numbers.players}</Row>
    </Section>
  )
}

export default function JoinPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // The code of the game joined, and whether this player started it, which only a game on the NAS can be
  const [joinedCode, setJoinedCode] = useState('')
  const startedHere = searchParams.get('started') === '1'
  const onNAS = isNASCode(joinedCode)
  const [menuOpen, setMenuOpen] = useState(false)
  const [nasNumbers, setNASNumbers] = useState<NASNumbers>()
  const sendCommand = useRef<(command: NASCommand) => void>(undefined)
  const keyboard = useKeyboardMapping()
  const [stage, setStage] = useState<Stage>('choosing')
  const [games, setGames] = useState<OpenGame[]>()
  const [code, setCode] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [found, setFound] = useState<Found>()
  // Where the game's picture is in what the host sends, which is their whole screen
  const [area, setArea] = useState<PictureArea>()
  // The connection to the host once it's made: what the performance overlay reads the stream from
  const [connection, setConnection] = useState<RTCPeerConnection>()
  const [perfOverlay] = usePerfOverlay()
  const stream = useStreamStats(perfOverlay ? connection : undefined, 'guest')
  const video = useRef<HTMLVideoElement>(null)
  // Everything this device is playing with: keys held, on-screen buttons held, and the on-screen sticks
  const keysHeld = useRef(new Set<RetroPadButton>())
  const touchHeld = useRef(new Set<RetroPadButton>())
  // eslint-disable-next-line react/hook-use-state -- made once, and never changed
  const [onScreen] = useState(connectGuestOnScreenGamepad)
  // eslint-disable-next-line react/hook-use-state -- made once, and never changed
  const [standIn] = useState(() => ({
    getStatus: () => 'running',
    pressDown: (button: string) => touchHeld.current.add(button as RetroPadButton),
    pressUp: (button: string) => touchHeld.current.delete(button as RetroPadButton),
  }))
  const touch = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
  const joined = stage === 'connecting' || stage === 'playing'

  // The games to choose from, looked at again every few seconds while choosing
  useEffect(() => {
    if (joined) {
      return
    }
    let stopped = false
    async function look() {
      try {
        const list = await listOpenGames()
        if (!stopped) {
          setGames(list)
        }
      } catch {
        // Looked at again shortly
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- look() answers for its own failures
    look()
    const timer = setInterval(look, listEvery)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [joined])

  // Joining is the guest's own press, which sound can't start without
  async function join(joinCode: string) {
    setNotFound(false)
    try {
      setFound(await findInvitation(joinCode))
      setJoinedCode(joinCode.replaceAll(/\s/gu, '').toUpperCase())
      setStage('connecting')
    } catch {
      setNotFound(true)
    }
  }

  // Arriving with a game's code, from starting it on the NAS, joins it straight away. The press that started it lets
  // its sound play here
  const arrivedWith = useRef(searchParams.get('code'))
  useEffect(() => {
    const arrived = arrivedWith.current
    if (arrived) {
      arrivedWith.current = null
      // oxlint-disable-next-line typescript/no-floating-promises -- join() answers for its own failures
      join(arrived)
    }
  })

  async function handleCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    await join(code)
  }

  useEffect(() => {
    if (!joined || !found) {
      return
    }
    let closed = false
    let timer: ReturnType<typeof setInterval> | undefined
    let session: Awaited<ReturnType<typeof joinGame>> | undefined
    // Never reaching the host is told apart from a game that was reached and then stopped
    let reached = false
    const giveUp = setTimeout(() => {
      if (!reached && !closed) {
        setStage('unreachable')
      }
    }, connectWithin)

    async function connect(joining: Found) {
      session = await joinGame({
        commands: onNAS,
        offer: joining.invitation.offer,
        onEnd() {
          if (reached && !closed) {
            setStage('ended')
          }
        },
        onNumbers: setNASNumbers,
        onPicture: setArea,
        onStream(stream) {
          // Given again as the sound joins the picture; setting it again would start the video over
          if (video.current && video.current.srcObject !== stream) {
            video.current.srcObject = stream
          }
        },
        reachableAt: await getOwnAddress(),
      })
      if (closed) {
        session.close()
        return
      }
      sendCommand.current = session.sendCommand
      const { connection } = session
      connection.addEventListener('connectionstatechange', () => {
        if (closed) {
          return
        }
        if (connection.connectionState === 'connected') {
          reached = true
          setConnection(connection)
          setStage('playing')
        } else if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
          setStage(reached ? 'ended' : 'unreachable')
        }
      })
      await joining.answer(session.answer)

      let lastSent = ''
      let lastSentAt = 0
      timer = setInterval(() => {
        const pad = mergePads([...keysHeld.current, ...touchHeld.current], [getController(), onScreen])
        const state = encodePadState(pad).join(',')
        const now = performance.now()
        if (state !== lastSent || now - lastSentAt >= resendEvery) {
          lastSent = state
          lastSentAt = now
          session?.sendPad(pad)
        }
      }, sendEvery)
    }
    // A game that can't be joined after all is one that couldn't be reached
    // oxlint-disable-next-line promise/prefer-await-to-then -- an effect can't wait
    connect(found).catch(() => setStage('unreachable'))
    return () => {
      closed = true
      clearTimeout(giveUp)
      clearInterval(timer)
      session?.close()
      sendCommand.current = undefined
      setConnection(undefined)
      setNASNumbers(undefined)
      setMenuOpen(false)
    }
  }, [joined, found, onScreen, onNAS])

  const playing = stage === 'playing'
  const layout = getPictureLayout(area)
  useEffect(() => {
    if (!playing) {
      return
    }
    const keys = getKeyButtons(keyboard)
    const held = keysHeld.current
    const abortController = new AbortController()
    function handleKey(event: KeyboardEvent) {
      // The pause key opens and closes a game on the NAS's pause menu
      if (onNAS && event.type === 'keydown' && getKeyNameFromCode(event.code) === keyboard.$pause) {
        event.preventDefault()
        setMenuOpen((open) => !open)
        return
      }
      const button = keys.get(getKeyNameFromCode(event.code))
      if (button) {
        event.preventDefault()
        if (event.type === 'keydown') {
          held.add(button)
        } else {
          held.delete(button)
        }
      }
    }
    document.addEventListener('keydown', handleKey, { signal: abortController.signal })
    document.addEventListener('keyup', handleKey, { signal: abortController.signal })
    return () => {
      abortController.abort()
      held.clear()
    }
  }, [playing, keyboard, onNAS])

  // The menu pauses the game while it's open, for everyone in it
  useEffect(() => {
    if (playing && onNAS) {
      sendCommand.current?.(menuOpen ? 'pause' : 'resume')
    }
  }, [menuOpen, playing, onNAS])

  function restart() {
    sendCommand.current?.('restart')
    setMenuOpen(false)
  }

  async function endGame() {
    try {
      await stopNASGame(joinedCode)
    } catch {
      // Already over
    }
    setMenuOpen(false)
    setStage('ended')
  }

  async function leave() {
    await navigate(routes.libraryHome)
  }

  return (
    <div className='fixed inset-0 z-20 flex touch-none items-center justify-center overflow-auto bg-black text-white'>
      {/* The game's picture alone, as large as fits, and its sound. What arrives is the host's whole screen, with black
          around the picture; until the host says where the picture is, all of it is shown. On an upright touch screen
          the picture sits at the top, clear of the controls */}
      <div
        className={clsx('overflow-hidden', playing ? 'relative' : 'hidden', {
          // Under the top bar's buttons, which are 44 points tall
          'portrait:mt-safe-offset-11 portrait:self-start': touch,
          'size-full': !layout,
        })}
        data-testid='guest-picture'
        style={layout?.box}
      >
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a game's picture and sound, which has no words to caption */}
        <video
          autoPlay
          className={layout ? 'absolute max-w-none object-fill' : 'size-full object-contain'}
          data-testid='guest-video'
          playsInline
          ref={video}
          style={layout?.video}
        />
      </div>

      {playing && touch && found ? (
        <TestSessionProvider emulator={standIn}>
          <div className='pointer-events-none absolute inset-0 *:pointer-events-auto'>
            <ConsoleControls kind={found.invitation.controls} />
          </div>
        </TestSessionProvider>
      ) : null}

      {/* The performance overlay's stream numbers, and a game on the NAS's own, where this device has it switched on.
          They take no touches */}
      {playing && perfOverlay && (stream || nasNumbers) ? (
        <div className='pointer-events-none absolute inset-0'>
          <div className={readoutBox} data-testid='guest-stream'>
            {nasNumbers ? <NASSection numbers={nasNumbers} /> : null}
            <StreamSection stats={stream} />
          </div>
        </div>
      ) : null}

      {/* Someone else paused a game on the NAS */}
      {playing && onNAS && nasNumbers?.paused && !menuOpen ? (
        <div className='pointer-events-none absolute inset-x-0 top-1/3 flex justify-center'>
          <span className='rounded-full bg-black/70 px-4 py-1.5 text-lg font-semibold'>Paused</span>
        </div>
      ) : null}

      {playing && onNAS && menuOpen && found ? (
        <NASMenu
          code={joinedCode}
          onEnd={endGame}
          onLeave={leave}
          onRestart={restart}
          onResume={() => setMenuOpen(false)}
          startedHere={startedHere}
          title={found.invitation.title}
        />
      ) : null}

      {stage === 'connecting' && found ? (
        <div className='flex flex-col items-center gap-3 p-6 text-center' data-testid='guest-connecting'>
          <span className='icon-[mdi--loading] size-8 animate-spin' />
          <p className='text-lg font-semibold'>{found.invitation.title}</p>
          <p className='text-white/70'>Connecting to {found.invitation.host || 'the other player'}.</p>
        </div>
      ) : null}

      {joined ? null : (
        <div className='flex w-full max-w-md flex-col items-stretch gap-6 p-6' data-sn-section=''>
          <h1 className='text-center text-2xl font-semibold'>{t('nav.joinGame')}</h1>

          {stage === 'ended' ? <p className='text-center'>The game ended.</p> : null}
          {stage === 'unreachable' ? (
            <p className='text-center text-[#ffc46b]' data-testid='guest-unreachable'>
              Couldn’t connect to the other player’s device.
            </p>
          ) : null}

          <div className='flex flex-col gap-3' data-testid='guest-games'>
            {games?.map((game) => (
              <button
                aria-label={`${game.title}, ${game.host}`}
                className={pill}
                data-sn-enabled
                data-sn-focus-style={focusStyle}
                key={game.code}
                onClick={() => join(game.code)}
                type='button'
              >
                <span className='icon-[mdi--play] size-6 shrink-0' />
                <span className='min-w-0 text-left'>
                  <span className='block truncate font-semibold'>{game.title}</span>
                  <span className='block truncate text-sm text-white/70'>{game.host}</span>
                </span>
              </button>
            ))}
            {games?.length === 0 ? (
              <p className='text-center text-white/70'>
                No games are being shared right now. One appears here when a player invites from their pause menu.
              </p>
            ) : null}
          </div>

          <form className='flex flex-col items-center gap-3 border-t border-white/15 pt-5' onSubmit={handleCode}>
            <label className='flex flex-col items-center gap-2'>
              <span className='text-sm text-white/70'>Or a code, if the other player has one for you</span>
              <input
                autoCapitalize='characters'
                autoComplete='off'
                autoCorrect='off'
                className='h-12 w-48 rounded-lg border border-solid border-white/60 bg-black text-center font-mono text-2xl tracking-[0.3em] uppercase'
                data-testid='guest-code'
                maxLength={codeLength + 1}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                value={code}
              />
            </label>
            {notFound ? <p className='text-[#ffc46b]'>No game to join by that code.</p> : null}
            <button
              className={pill}
              data-testid='guest-join'
              disabled={code.replaceAll(/\s/gu, '').length < codeLength}
              type='submit'
            >
              Join with code
            </button>
          </form>
        </div>
      )}

      {playing && onNAS ? (
        <button
          aria-label='Pause'
          className='top-safe-offset-2 right-safe-offset-14 absolute flex size-11 items-center justify-center rounded-full hover:bg-white/15'
          data-sn-enabled
          data-testid='nas-pause'
          onClick={() => setMenuOpen(true)}
          type='button'
        >
          <span className='icon-[mdi--pause] size-6' />
        </button>
      ) : null}

      <button
        aria-label='Leave'
        className='top-safe-offset-2 right-safe-offset-2 absolute flex size-11 items-center justify-center rounded-full hover:bg-white/15'
        data-sn-enabled
        onClick={leave}
        type='button'
      >
        <span className='icon-[mdi--close] size-6' />
      </button>
    </div>
  )
}
