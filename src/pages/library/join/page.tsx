import { clsx } from 'clsx'
import { delay, noop } from 'es-toolkit'
import {
  type PointerEvent as ReactPointerEvent,
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { resolveConsole } from '#@/consoles/registry.ts'
import { goesFullscreen } from '#@/constants/preference.ts'
import { followVolume } from '#@/emulator/audio.ts'
import { getPictureLayout, type PictureArea } from '#@/emulator/game-picture.ts'
import { failureWordsFor, isGameGone, isNASCode, normalizeCode, stopNASGame } from '#@/emulator/nas-games.ts'
import { connectGuestOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { findInvitation, getOwnAddress, listOpenGames, type OpenGame } from '#@/emulator/play-together-signal.ts'
import { encodePadState, joinGame, type NASCommand, type NASNumbers, type Stylus } from '#@/emulator/play-together.ts'
import { getConsoleKeys } from '#@/input/console-keys.ts'
import { getConsoleKeyInputs, getKeyButtons, type KeyInputs, mergePads, stickAxes } from '#@/input/guest-pad.ts'
import { getPadKeys } from '#@/input/pad.ts'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useGameJoined, useSpatialNavigationPaused } from '#@/pages/library/atoms.ts'
import { TestSessionProvider } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { ConsoleControls } from '#@/pages/library/components/emulator-portal/game-overlay/console-controls.tsx'
import {
  readoutBox,
  Row,
  Section,
  StreamSection,
} from '#@/pages/library/components/emulator-portal/game-overlay/perf-readout.tsx'
import { VirtualGamepadButton } from '#@/pages/library/components/emulator-portal/game-overlay/virtual-gamepad-button.tsx'
import { useFocusIndicator } from '#@/pages/library/hooks/use-focus-indicator.ts'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'
import { useNotice } from '#@/pages/library/hooks/use-notice.ts'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useStreamStats } from '#@/pages/library/hooks/use-stream-stats.ts'
import { useFollowTouchControls, useTouchControls } from '#@/pages/library/hooks/use-touch-controls.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'
import { cancel, holdLayer } from '#@/pages/library/utils/spatial-navigation.ts'
import { routes } from '#@/pages/routes.ts'
import { Gamepad } from '#@/utils/client/gamepad.ts'
import { holdsShortcut, remapController, serverGameTitle } from './controller.ts'
import { ServerPauseMenu } from './server-pause-menu.tsx'
import { canSetVolume, closeSound, contextReady, playThroughContext, readySound } from './sound.ts'

// A guest's side of a game played together: the host's game, as a picture and sound sent from their device, with this
// device's keys, controller or on-screen controls playing as the next player.
//
// A game on the NAS is played here too, by everyone in it: whoever starts it from its page arrives with its code, and
// joins first. Such a game has a pause menu, which pauses it for everyone in it
//
// The games being shared are listed, to join with one press: a code is awkward to type with a controller. A host who
// asked for a code is joined by typing it instead

// The controller is sent when it changes, and again this often in case a message was lost on the way
const resendEvery = 100
const sendEvery = 16
// How often the list of games is looked at again, while the page is in view
const listEvery = 3000
// How long the two devices are given to reach each other before it's called off
const connectWithin = 20_000
// A game on the NAS sends its numbers every second: this long without them, the connection is in trouble
const quietFor = 4000

// Choosing a game, reaching its host, playing, or one of the ways it stops: the game ended, it was never reached, or
// the connection to a game on the NAS was lost while the game may still be running
type Stage = 'choosing' | 'connecting' | 'ended' | 'lost' | 'playing' | 'unreachable'

type Found = Awaited<ReturnType<typeof findInvitation>>

// A join that didn't work: what's said, and whether it was about a code typed in the box
interface Failure {
  typed: boolean
  words: string
}

const codeLength = 6
const pill =
  'flex min-h-12 items-center gap-3 rounded-full border border-solid border-white px-5 py-2 hover:bg-white/15 disabled:opacity-50'
const focusStyle = JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })
// The top bar's buttons, as a game on this device has them: squares a finger can hit
const barIcon = 'absolute top-safe flex size-11 items-center justify-center rounded hover:bg-white/15'
const keypadControls = new Set(['atari5200', 'colecovision'])

/** The first real controller connected to this device */
function getController() {
  return [...(navigator.getGamepads?.() ?? [])].find((gamepad) => gamepad?.connected)
}

/** A console by name, with its emulator; nothing for one this app doesn't know */
function findConsole(platform: string, core: string) {
  try {
    return resolveConsole(platform, core)
  } catch {
    return undefined
  }
}

/** Fullscreen, where the player has games go fullscreen, in the press that joins while the browser still allows it */
function goFullscreen(fullscreen: Parameters<typeof goesFullscreen>[0]) {
  if (goesFullscreen(fullscreen) && !document.fullscreenElement) {
    // oxlint-disable-next-line promise/prefer-await-to-then -- not waited for: the game is joined all the same
    document.body.requestFullscreen?.().catch(noop)
  }
}

function leaveFullscreen() {
  if (document.fullscreenElement) {
    // oxlint-disable-next-line promise/prefer-await-to-then -- nothing to wait for
    document.exitFullscreen().catch(noop)
  }
}

/** A game on the NAS's numbers, as a section of the performance overlay */
function NASSection({ numbers }: Readonly<{ numbers: NASNumbers }>) {
  return (
    <Section title='Game, on the server'>
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
  const notify = useNotice()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  // The code of the game joined, and whether this player started it, which only a game on the NAS can be
  const [joinedCode, setJoinedCode] = useState('')
  const [startedHere, setStartedHere] = useState(false)
  const onNAS = isNASCode(joinedCode)
  const [menuOpen, setMenuOpen] = useState(false)
  // A guest of a person's game has no pause menu: pause asks whether to leave instead
  const [leaveAsked, setLeaveAsked] = useState(false)
  const overlayOpen = menuOpen || leaveAsked
  const { preference } = usePreference()
  const [nasNumbers, setNASNumbers] = useState<NASNumbers>()
  const sendCommand = useRef<(command: NASCommand) => void>(undefined)
  // Sends the controller as it is now, rather than at the next send
  const sendNow = useRef<() => void>(undefined)
  const keyboard = useKeyboardMapping()
  const gamepadMapping = useGamepadMapping()
  const [stage, setStage] = useState<Stage>('choosing')
  const [games, setGames] = useState<OpenGame[]>()
  const [code, setCode] = useState('')
  // The code being looked up, while it is: the list and the box wait for it, so a second press can't join twice
  const [pending, setPending] = useState<string>()
  const joining = useRef(false)
  // The starter's End under way: the game stopping is then no news, and the menu stays up until the page is left
  const ending = useRef(false)
  const [failure, setFailure] = useState<Failure>()
  const [found, setFound] = useState<Found>()
  // Where the game's picture is in what the host sends, which is their whole screen
  const [area, setArea] = useState<PictureArea>()
  // The connection to the host once it's made: what the performance overlay reads the stream from
  const [connection, setConnection] = useState<RTCPeerConnection>()
  // The connection to a game on the NAS has gone quiet or dropped, and may come back
  const [trouble, setTrouble] = useState(false)
  const [perfOverlay] = usePerfOverlay()
  const stream = useStreamStats(perfOverlay ? connection : undefined, 'guest')
  const video = useRef<HTMLVideoElement>(null)
  const picture = useRef<MediaStream>(undefined)
  // Whether the game's sound plays, or waits for a press to let it in; and whether the picture itself waits for one
  const [sound, setSound] = useState<'blocked' | 'off' | 'on'>('off')
  const [startBlocked, setStartBlocked] = useState(false)
  // Everything this device is playing with: keys held, on-screen buttons held, and the on-screen sticks
  const keysHeld = useRef(new Set<RetroPadButton>())
  // Keys held that push a stick, such as the N64's arrows
  const stickKeysHeld = useRef(new Set<string>())
  const keyInputsSent = useRef<KeyInputs>({ buttons: new Map(), sticks: new Map() })
  // The stylus on a DS game on the NAS: a finger or the mouse on the picture, whose bottom half is the touch screen.
  // Undefined while there's no touch screen to send it to
  const stylus = useRef<Stylus | undefined>(undefined)
  // Where a press began that hasn't been sent yet: a tap quicker than one send to the next is still sent as a touch
  const stylusPress = useRef<Stylus | undefined>(undefined)
  const touchHeld = useRef(new Set<RetroPadButton>())
  // eslint-disable-next-line react/hook-use-state -- made once, and never changed
  const [onScreen] = useState(connectGuestOnScreenGamepad)
  // eslint-disable-next-line react/hook-use-state -- made once, and never changed
  const [standIn] = useState(() => ({
    getStatus: () => 'running',
    pressDown: (button: string) => touchHeld.current.add(button as RetroPadButton),
    pressUp: (button: string) => touchHeld.current.delete(button as RetroPadButton),
  }))
  // On-screen controls by how the game is played, as on this device: a touch brings them, a real key puts them away,
  // and a controller connected puts them away until the toggle brings them back
  useFollowTouchControls()
  const touchControls = useTouchControls()
  const { connected } = useGamepads()
  const [controlsShown, setControlsShown] = useState(!connected)
  const [wasConnected, setWasConnected] = useState(connected)
  if (wasConnected !== connected) {
    setWasConnected(connected)
    setControlsShown(!connected)
  }
  const [keypadOpen, setKeypadOpen] = useState(false)
  const joined = stage === 'connecting' || stage === 'playing'
  const playing = stage === 'playing'

  // For what outlives a render: the loop that sends the controller, and the listeners
  const latest = useRef({ menuOpen, onNAS, players: 0 })
  const gamepadMappings = useRef(preference.input.gamepadMappings)
  useEffect(() => {
    latest.current = { menuOpen, onNAS, players: nasNumbers?.players ?? 0 }
    gamepadMappings.current = preference.input.gamepadMappings
  })

  // The page is a layer over the library: what's behind it can't be reached by Tab, the arrows or a screen reader
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => (root.current ? holdLayer(root.current) : undefined), [])

  // While a game is reached or played, the phone's bar is put away, as it is under a game on this device
  const [, setGameJoined] = useGameJoined()
  useEffect(() => {
    setGameJoined(joined)
    return () => setGameJoined(false)
  }, [joined, setGameJoined])

  // The games to choose from, looked at again every few seconds while choosing and while the page is in view
  useEffect(() => {
    if (joined) {
      return
    }
    let stopped = false
    let shown = ''
    async function look() {
      if (document.visibilityState !== 'visible') {
        return
      }
      try {
        const list = await listOpenGames()
        const listed = JSON.stringify(list)
        if (!stopped && listed !== shown) {
          shown = listed
          setGames(list)
        }
      } catch {
        // Looked at again shortly
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- look() answers for its own failures
    look()
    const timer = setInterval(look, listEvery)
    const abortController = new AbortController()
    document.addEventListener('visibilitychange', look, { signal: abortController.signal })
    return () => {
      stopped = true
      clearInterval(timer)
      abortController.abort()
    }
  }, [joined])

  /**
   * Joins a game: the guest's own press, which sound can't start without. `arrived` is one started from its page, whose
   * code was never typed; `rejoin` is one whose connection was lost
   */
  async function join(joinCode: string, { arrived = false, rejoin = false, started = false, typed = false } = {}) {
    if (joining.current) {
      return
    }
    joining.current = true
    readySound()
    if (!arrived) {
      goFullscreen(preference.emulator.fullscreen)
    }
    const normalized = normalizeCode(joinCode)
    setPending(normalized)
    setFailure(undefined)
    try {
      const joining = await findInvitation(normalized)
      setFound(joining)
      setJoinedCode(normalized)
      // The server says whether this player started a game on it, however they came back to it
      setStartedHere(isNASCode(normalized) && (started || Boolean(joining.invitation.startedHere)))
      setStage('connecting')
    } catch (error) {
      leaveFullscreen()
      let words = failureWordsFor(error)
      const notFound = isGameGone(error)
      if (rejoin && notFound) {
        words = 'playTogether.ended'
      } else if (arrived && (notFound || !words)) {
        // A code never typed: the game started, but couldn't be joined
        words = 'join.joinFailedServer'
      }
      setFailure({ typed, words: words ?? 'join.joinFailed' })
      if (rejoin || arrived) {
        setStage('choosing')
      }
    } finally {
      joining.current = false
      setPending(undefined)
    }
  }

  // Arriving with a game's code, from starting it on the NAS, joins it straight away, as its starter. The press that
  // started it lets its sound play here. The code is taken from the address, so going back to it doesn't join again
  const arrivedWith = useRef(searchParams.get('code'))
  const arrivedStarted = useRef(Boolean((location.state as { started?: boolean } | null)?.started))
  useEffect(() => {
    const arrived = arrivedWith.current
    if (arrived) {
      arrivedWith.current = null
      // oxlint-disable-next-line typescript/no-floating-promises -- the address is only tidied
      navigate(routes.libraryJoin, { replace: true })
      // oxlint-disable-next-line typescript/no-floating-promises -- join() answers for its own failures
      join(arrived, { arrived: true, started: arrivedStarted.current })
    }
  })

  async function handleCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    await join(code, { typed: true })
  }

  async function rejoin() {
    await join(joinedCode, { rejoin: true, started: startedHere })
  }

  // The picture plays muted at first, which every browser allows, then the sound is let in where the browser allows it
  // without a press; otherwise a tap lets it in
  const showPicture = useEffectEvent(async (given: MediaStream) => {
    const element = video.current
    if (!element) {
      return
    }
    if (element.srcObject !== given) {
      // Given again as the sound joins the picture; setting it again would start the video over
      picture.current = given
      element.srcObject = given
      element.muted = true
      try {
        await element.play()
        setStartBlocked(false)
      } catch {
        setStartBlocked(true)
        return
      }
    }
    if (sound === 'on' || given.getAudioTracks().length === 0) {
      return
    }
    if (!canSetVolume()) {
      setSound(contextReady() && playThroughContext(given) ? 'on' : 'blocked')
      return
    }
    element.muted = false
    try {
      await element.play()
      setSound('on')
    } catch {
      element.muted = true
      // oxlint-disable-next-line promise/prefer-await-to-then -- it played muted a moment ago
      element.play().catch(noop)
      setSound('blocked')
    }
  })

  // A press lets the picture and its sound in
  async function pressForSound() {
    const element = video.current
    const given = picture.current
    if (!element || !given) {
      return
    }
    // Before anything is waited for, while the press still counts
    readySound()
    const withSound = canSetVolume() && given.getAudioTracks().length > 0
    element.muted = !withSound
    try {
      await element.play()
      setStartBlocked(false)
    } catch {
      setStartBlocked(true)
      return
    }
    if (withSound || playThroughContext(given)) {
      setSound('on')
    }
  }

  useEffect(() => {
    if (!playing || (sound !== 'blocked' && !startBlocked)) {
      return
    }
    // Any touch, click or key lets the sound in, not only the prompt
    const abortController = new AbortController()
    const options = { capture: true, signal: abortController.signal }
    document.addEventListener('pointerup', pressForSound, options)
    document.addEventListener('keydown', pressForSound, options)
    return () => abortController.abort()
  })

  // The sound stops with the game
  useEffect(() => closeSound, [])

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
    // A game on the NAS that stops is told apart from a connection to it that's lost, which can be joined again
    function stopped() {
      if (ending.current) {
        return
      }
      const state = session?.connection.connectionState
      setStage(onNAS && state !== 'connected' && state !== 'closed' ? 'lost' : 'ended')
    }

    async function connect(joining: Found) {
      session = await joinGame({
        commands: onNAS,
        offer: joining.invitation.offer,
        onEnd() {
          if (reached && !closed) {
            stopped()
          }
        },
        onNumbers(numbers) {
          lastNumbers.current = performance.now()
          setNASNumbers(numbers)
        },
        onPicture: setArea,
        onStream(given) {
          // oxlint-disable-next-line typescript/no-floating-promises -- showPicture() answers for its own failures
          showPicture(given)
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
        const state = connection.connectionState
        if (state === 'connected') {
          reached = true
          lastNumbers.current = performance.now()
          setTrouble(false)
          setConnection(connection)
          setStage('playing')
        } else if (state === 'disconnected') {
          setTrouble(reached)
        } else if (state === 'failed') {
          if (reached) {
            stopped()
          } else {
            setStage('unreachable')
          }
        } else if (state === 'closed' && !ending.current) {
          setStage(reached ? 'ended' : 'unreachable')
        }
      })
      await joining.answer(session.answer)
      // Left while the answer was on its way
      if (closed) {
        return
      }

      let lastSent = ''
      let lastSentAt = 0
      function send(force = false) {
        const keyStick = { axes: stickAxes(stickKeysHeld.current, keyInputsSent.current.sticks) }
        const controller = getController()
        const own = controller ? remapController(controller, gamepadMappings.current[controller.id]) : undefined
        const pad = mergePads([...keysHeld.current, ...touchHeld.current], [keyStick, own, onScreen])
        const pen = stylusPress.current ?? stylus.current
        stylusPress.current = undefined
        const state = encodePadState(pad, pen).join(',')
        const now = performance.now()
        if (force || state !== lastSent || now - lastSentAt >= resendEvery) {
          lastSent = state
          lastSentAt = now
          session?.sendPad(pad, pen)
        }
      }
      sendNow.current = () => send(true)
      timer = setInterval(send, sendEvery)
    }
    // A game that can't be joined after all is one that couldn't be reached, unless the server said why: someone else
    // joining it first, say
    // oxlint-disable-next-line promise/prefer-await-to-then -- an effect can't wait
    connect(found).catch((error: unknown) => {
      const words = failureWordsFor(error)
      if (words && !closed) {
        setFailure({ typed: false, words })
        setStage('choosing')
      } else {
        setStage('unreachable')
      }
    })
    return () => {
      closed = true
      clearTimeout(giveUp)
      clearInterval(timer)
      // A player who goes with the menu open leaves the game running for the others
      if (onNAS && latest.current.menuOpen) {
        session?.sendCommand('resume')
      }
      session?.close()
      sendCommand.current = undefined
      sendNow.current = undefined
      setConnection(undefined)
      setNASNumbers(undefined)
      setTrouble(false)
      setMenuOpen(false)
      setLeaveAsked(false)
    }
  }, [joined, found, onScreen, onNAS])

  // A game on the NAS that goes quiet, or whose connection drops, is said to be in trouble until it's heard again
  const lastNumbers = useRef(0)
  useEffect(() => {
    if (!playing || !onNAS) {
      return
    }
    const timer = setInterval(() => {
      const quiet = performance.now() - lastNumbers.current > quietFor
      setTrouble(quiet || connection?.connectionState === 'disconnected')
    }, 1000)
    return () => clearInterval(timer)
  }, [playing, onNAS, connection])

  // The top of the controls that a game is kept above in portrait, as it is on this device: the DS's, Lynx's and
  // WonderSwan's. The picture then takes the space above them, from the top of the screen
  const controlsTop = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number>()
  const showControls = playing && touchControls && controlsShown && Boolean(found) && !overlayOpen
  useEffect(() => {
    if (!showControls) {
      return
    }
    function measure() {
      const rect = controlsTop.current?.getBoundingClientRect()
      const portrait = globalThis.matchMedia('(orientation: portrait)').matches
      setRoom(rect && rect.top > 0 && portrait ? Math.floor(rect.top) : undefined)
    }
    measure()
    const abortController = new AbortController()
    globalThis.addEventListener('resize', measure, { signal: abortController.signal })
    globalThis.visualViewport?.addEventListener('resize', measure, { signal: abortController.signal })
    return () => abortController.abort()
  }, [showControls])
  const layout = getPictureLayout(area, showControls ? room : undefined)

  // The game's sound plays as loud as the volume in the pause menu's settings, the same one games on this device use.
  // Where a video's volume can't be set, the sound plays through an AudioContext, which follows it by itself
  useEffect(
    () =>
      followVolume((gain) => {
        if (video.current && canSetVolume()) {
          video.current.volume = gain
        }
      }),
    [],
  )

  // The game's console, where the host said: its keys are the ones the player plays it with in the browser, and its
  // controller is drawn with them in a NAS game's menu. Otherwise the shared keys play the standard buttons
  const platform = found?.invitation.platform
  const core = found?.invitation.core
  const gameConsole = useMemo(() => (platform && core ? findConsole(platform, core) : undefined), [platform, core])
  const ownKeys = platform
    ? preference.input.consoleKeys?.[platform as keyof typeof preference.input.consoleKeys]
    : undefined
  const keyInputs = useMemo<KeyInputs>(
    () =>
      gameConsole
        ? getConsoleKeyInputs(getConsoleKeys(gameConsole, keyboard, ownKeys))
        : { buttons: getKeyButtons(keyboard), sticks: new Map() },
    [gameConsole, keyboard, ownKeys],
  )
  // For the loop that sends the controller, which outlives a render
  useEffect(() => {
    keyInputsSent.current = keyInputs
  }, [keyInputs])
  const padKeys = gameConsole ? getPadKeys(gameConsole, keyboard, { own: ownKeys }) : undefined
  // A game on the NAS by its name as the library shows it; a person's game by the name its host gave
  let title = found?.invitation.title ?? ''
  if (found && onNAS) {
    title = serverGameTitle(found.invitation.title, platform)
  }

  // A DS game on the NAS takes the stylus; a person's device, sharing a game, doesn't
  const takesStylus = onNAS && platform === 'nds'
  useEffect(() => {
    stylus.current = takesStylus ? { down: false, x: 0.5, y: 0.75 } : undefined
  }, [takesStylus])

  // The stylus is lifted as the menu opens, so a touch held as it opened doesn't stay down in the game
  useEffect(() => {
    if (overlayOpen && stylus.current) {
      stylus.current = { ...stylus.current, down: false }
      stylusPress.current = undefined
    }
  }, [overlayOpen])

  function moveStylus(event: ReactPointerEvent<HTMLDivElement>, down?: boolean) {
    if (!stylus.current || overlayOpen) {
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    const isDown = down ?? stylus.current.down
    // Only where it touches, or drags, counts: a mouse moving over the picture with no button down is no stylus
    if (down === undefined && !isDown) {
      return
    }
    event.preventDefault()
    stylus.current = {
      down: isDown,
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
    if (down) {
      stylusPress.current = stylus.current
    }
  }

  // While the game is played, the arrows and Enter are the game's, not the page's: the highlight moving between the
  // page's buttons stands still, as it does in a game played in the browser. An open menu has them back
  const [, setNavigationPaused] = useSpatialNavigationPaused()
  useEffect(() => {
    setNavigationPaused(playing && !overlayOpen)
    return () => setNavigationPaused(false)
  }, [playing, overlayOpen, setNavigationPaused])

  // Back in the game, nothing of the page keeps the focus or its highlight: a join pressed from the list, or the menu
  // just closed, leaves none over the picture
  const { syncStyle } = useFocusIndicator()
  useEffect(() => {
    if (joined && !overlayOpen && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    syncStyle()
  }, [joined, overlayOpen, syncStyle])

  // Pause opens a game on the server's menu, and goes back in it: from a page to the menu, and from the menu to the
  // game. A guest of a person's game is asked whether to leave
  function pressPause() {
    if (onNAS) {
      if (menuOpen) {
        cancel()
      } else {
        setMenuOpen(true)
      }
    } else {
      setLeaveAsked(!leaveAsked)
    }
  }

  // A controller's pause buttons, as set in Settings, do the same, as they do in a game on this device
  const handleGamepadPress = useEffectEvent(({ gamepad }: { gamepad: globalThis.Gamepad }) => {
    if (playing && holdsShortcut(gamepad.buttons, gamepadMapping.$pause, gamepadMapping)) {
      pressPause()
    }
  })
  useEffect(() => Gamepad.onPress(handleGamepadPress), [])

  useEffect(() => {
    if (!playing) {
      return
    }
    const { buttons, sticks } = keyInputs
    const held = keysHeld.current
    const stickHeld = stickKeysHeld.current
    const abortController = new AbortController()
    function handleKey(event: KeyboardEvent) {
      const keyName = getKeyNameFromCode(event.code)
      if (event.type === 'keydown' && keyName === keyboard.$pause) {
        event.preventDefault()
        if (!event.repeat) {
          pressPause()
        }
        return
      }
      // With the menu open, the keys move in it, and play nothing
      if (overlayOpen) {
        return
      }
      const button = buttons.get(keyName)
      const stick = sticks.has(keyName)
      const down = event.type === 'keydown'
      if (button) {
        event.preventDefault()
        if (down) {
          held.add(button)
        } else {
          held.delete(button)
        }
      } else if (stick) {
        event.preventDefault()
        if (down) {
          stickHeld.add(keyName)
        } else {
          stickHeld.delete(keyName)
        }
      } else if (keyName === 'enter' || keyName === 'space') {
        // Not for whatever button of the page has the focus: Space held out of habit doesn't leave the game
        event.preventDefault()
      }
    }
    document.addEventListener('keydown', handleKey, { signal: abortController.signal })
    document.addEventListener('keyup', handleKey, { signal: abortController.signal })
    return () => {
      abortController.abort()
      held.clear()
      stickHeld.clear()
    }
  })

  // Keys and buttons held as the player switches to another window or app are let go, since their release goes there.
  // A player alone in a game on the NAS who switches away has it paused, and finds its menu when they're back
  useEffect(() => {
    if (!playing) {
      return
    }
    function letGo() {
      keysHeld.current.clear()
      stickKeysHeld.current.clear()
      touchHeld.current.clear()
      if (stylus.current) {
        stylus.current = { ...stylus.current, down: false }
      }
      sendNow.current?.()
    }
    function handleVisibility() {
      if (document.visibilityState !== 'hidden') {
        return
      }
      letGo()
      const { menuOpen: open, onNAS: server, players } = latest.current
      if (server && players === 1 && !open) {
        sendCommand.current?.('pause')
        setMenuOpen(true)
      }
    }
    const abortController = new AbortController()
    globalThis.addEventListener('blur', letGo, { signal: abortController.signal })
    document.addEventListener('visibilitychange', handleVisibility, { signal: abortController.signal })
    return () => abortController.abort()
  }, [playing])

  // The menu pauses the game while it's open, for everyone in it. Only a player who paused it resumes it: one who has
  // just joined a game paused by someone else's menu leaves it paused
  const pausedHere = useRef(false)
  useEffect(() => {
    if (!playing || !onNAS) {
      return
    }
    if (menuOpen) {
      pausedHere.current = true
      sendCommand.current?.('pause')
    } else if (pausedHere.current) {
      pausedHere.current = false
      sendCommand.current?.('resume')
    }
  }, [menuOpen, playing, onNAS])

  function restart() {
    sendCommand.current?.('restart')
    setMenuOpen(false)
  }

  // Back to where the game was joined or started from, as exiting a game on this device goes back to its page
  async function goBack() {
    leaveFullscreen()
    await (globalThis.history.length > 1 ? navigate(-1) : navigate(routes.libraryHome))
  }

  // Ending the game goes back to where it was started from, its page. A game already over is ended all the same; one
  // that couldn't be ended stays, and says so
  async function endGame() {
    ending.current = true
    try {
      await stopNASGame(joinedCode)
    } catch (error) {
      if (!isGameGone(error)) {
        ending.current = false
        notify(t(failureWordsFor(error) ?? 'join.endFailed'))
        return
      }
    }
    await goBack()
  }

  // Leaving with the menu open lets the game go on for the others first
  async function leave() {
    if (onNAS && menuOpen) {
      sendCommand.current?.('resume')
      await delay(100)
    }
    await goBack()
  }

  // What's happening, for a screen reader: said as it changes
  const status = (() => {
    if (pending) {
      return t('join.joining')
    }
    if (stage === 'connecting') {
      return onNAS ? t('playTogether.connectingServer') : t('playTogether.connectingOther')
    }
    if (stage === 'ended') {
      return t('playTogether.ended')
    }
    if (playing && trouble) {
      return t('join.reconnecting')
    }
    if (playing && onNAS && nasNumbers?.paused && !menuOpen) {
      return t('pauseMenu.paused')
    }
    return ''
  })()
  const failureText = (() => {
    if (stage === 'unreachable') {
      return onNAS ? t('join.unreachableServer') : t('playTogether.unreachable')
    }
    if (stage === 'lost') {
      return t('join.connectionLost')
    }
    return failure ? t(failure.words) : ''
  })()
  let connectingText = t('playTogether.connectingOther')
  if (onNAS) {
    connectingText = t('playTogether.connectingServer')
  } else if (found?.invitation.host) {
    connectingText = t('playTogether.connectingTo', { host: found.invitation.host })
  }
  const keypad = Boolean(found && keypadControls.has(found.invitation.controls))

  return (
    <div
      className={clsx(
        'fixed inset-0 z-20 flex justify-center overflow-auto bg-black text-white',
        // Playing, the page is the game's, and takes every touch; choosing, it scrolls, from its top where it's taller
        // than the screen
        joined ? 'touch-none items-center' : 'items-center-safe',
      )}
      data-sn-layer=''
      ref={root}
    >
      <output aria-live='polite' className='sr-only'>
        {status}
      </output>

      {/* The game's picture alone, as large as fits, and its sound. What arrives is the host's whole screen, with black
          around the picture; until the host says where the picture is, all of it is shown. On an upright touch screen
          the picture sits at the top, clear of the controls */}
      <div
        className={clsx('overflow-hidden', playing ? 'relative' : 'hidden', {
          // Under the top bar's buttons, which are 44 points tall, unless it's kept above the controls
          'portrait:mt-safe-offset-11': touchControls && (!showControls || room === undefined),
          'portrait:self-start': touchControls,
          'size-full': !layout,
        })}
        data-testid='guest-picture'
        onPointerCancel={(event) => moveStylus(event, false)}
        onPointerDown={(event) => {
          if (stylus.current) {
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          moveStylus(event, true)
        }}
        onPointerMove={(event) => moveStylus(event)}
        onPointerUp={(event) => moveStylus(event, false)}
        style={layout?.box ?? (showControls && room !== undefined ? { height: room } : undefined)}
      >
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a game's picture and sound, which has no words to caption */}
        <video
          autoPlay
          className={layout ? 'absolute max-w-none object-fill' : 'size-full object-contain'}
          data-testid='guest-video'
          muted
          playsInline
          ref={video}
          style={layout?.video}
        />
      </div>

      {showControls && found ? (
        <TestSessionProvider emulator={standIn}>
          <div className='pointer-events-none absolute inset-0 *:pointer-events-auto'>
            <ConsoleControls
              coin={gameConsole?.coin}
              keypadOpen={keypadOpen}
              kind={found.invitation.controls}
              onKeypadClose={() => setKeypadOpen(false)}
              top={controlsTop}
            />
          </div>
        </TestSessionProvider>
      ) : null}

      {/* The performance overlay's stream numbers, and a game on the NAS's own, where this device has it switched on.
          They take no touches */}
      {playing && perfOverlay && (stream || nasNumbers) && !overlayOpen ? (
        <div className='pointer-events-none absolute inset-0'>
          <div className={readoutBox} data-testid='guest-stream'>
            {nasNumbers ? <NASSection numbers={nasNumbers} /> : null}
            <StreamSection stats={stream} />
          </div>
        </div>
      ) : null}

      {/* Someone else paused a game on the NAS, or the connection to it is in trouble */}
      {playing && !overlayOpen && (trouble || (onNAS && nasNumbers?.paused)) ? (
        <div className='pointer-events-none absolute inset-x-0 top-1/3 flex justify-center'>
          <span className='flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 text-lg font-semibold'>
            {trouble ? <span className='icon-[svg-spinners--180-ring] size-5' /> : null}
            {trouble ? t('join.reconnecting') : t('pauseMenu.paused')}
          </span>
        </div>
      ) : null}

      {/* The picture waits for a press, where the browser wouldn't start it by itself */}
      {playing && startBlocked && !overlayOpen ? (
        <button
          className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-lg font-semibold'
          data-sn-enabled
          data-testid='guest-tap-to-start'
          onClick={pressForSound}
          type='button'
        >
          <span className='icon-[mdi--play-circle] size-16' />
          {t('join.tapToStart')}
        </button>
      ) : null}

      {/* So does the sound, which any press lets in */}
      {playing && !startBlocked && sound === 'blocked' && !overlayOpen ? (
        <button
          className='top-safe-offset-2 absolute left-1/2 flex h-9 -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 text-sm font-semibold ring-1 ring-white/25'
          data-testid='guest-tap-for-sound'
          onClick={pressForSound}
          type='button'
        >
          <span className='icon-[mdi--volume-off] size-5' />
          {t('join.tapForSound')}
        </button>
      ) : null}

      {playing && onNAS && menuOpen && found ? (
        <ServerPauseMenu
          code={joinedCode}
          friendCode={found.invitation.friendCode}
          linked={Boolean(found.invitation.linked)}
          onClose={() => setMenuOpen(false)}
          onEnd={endGame}
          onLeave={leave}
          onRestart={restart}
          pad={padKeys}
          players={nasNumbers?.players}
          startedHere={startedHere}
          title={title}
        />
      ) : null}

      {/* A guest of a person's game, asked whether to leave it */}
      {playing && leaveAsked ? (
        <div
          aria-labelledby='guest-leave-title'
          aria-modal
          className='absolute inset-0 flex items-center justify-center bg-black/60 p-6'
          data-testid='guest-leave'
          role='alertdialog'
        >
          <div className='flex flex-col items-center gap-5 rounded-2xl bg-neutral-900/90 p-6 text-center'>
            <p className='text-lg font-semibold' id='guest-leave-title'>
              {t('join.leaveAsk')}
            </p>
            <div className='flex gap-3'>
              <button
                className={pill}
                data-sn-enabled
                data-sn-focus-style={focusStyle}
                onClick={() => setLeaveAsked(false)}
                type='button'
              >
                {t('common.cancel')}
              </button>
              <button
                className={pill}
                data-sn-enabled
                data-sn-focus-style={focusStyle}
                data-testid='guest-leave-confirm'
                onClick={leave}
                type='button'
              >
                <span className='icon-[mdi--exit-to-app] size-5' />
                {t('pauseMenu.leave')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === 'connecting' && found ? (
        <div className='flex flex-col items-center gap-3 p-6 text-center' data-testid='guest-connecting'>
          <span className='icon-[mdi--loading] size-8 animate-spin' />
          <p className='text-lg font-semibold'>{title}</p>
          <p className='text-white/70'>{connectingText}</p>
        </div>
      ) : null}

      {joined ? null : (
        <div className='flex w-full max-w-md flex-col items-stretch gap-6 p-6' data-sn-section=''>
          <h1 className='text-center text-2xl font-semibold'>{t('nav.joinGame')}</h1>

          {stage === 'ended' ? <p className='text-center'>{t('playTogether.ended')}</p> : null}
          {stage === 'unreachable' || stage === 'lost' ? (
            <div className='flex flex-col items-center gap-3'>
              <p className='text-center text-[#ffc46b]' data-testid='guest-unreachable' role='alert'>
                {failureText}
              </p>
              {stage === 'lost' ? (
                <button
                  className={pill}
                  data-sn-enabled
                  data-sn-focus-style={focusStyle}
                  data-testid='guest-rejoin'
                  disabled={Boolean(pending)}
                  onClick={rejoin}
                  type='button'
                >
                  <span className={clsx('size-6', pending ? 'icon-[svg-spinners--180-ring]' : 'icon-[mdi--refresh]')} />
                  {t('join.rejoin')}
                </button>
              ) : null}
            </div>
          ) : null}
          {failure && !failure.typed ? (
            <p className='text-center text-[#ffc46b]' data-testid='guest-join-failed' role='alert'>
              {t(failure.words)}
            </p>
          ) : null}

          <div className='flex flex-col gap-3' data-testid='guest-games'>
            {games?.map((game) => (
              <button
                aria-label={`${game.title}, ${game.host}`}
                className={pill}
                data-sn-enabled
                data-sn-focus-style={focusStyle}
                disabled={Boolean(pending)}
                key={game.code}
                onClick={() => join(game.code)}
                type='button'
              >
                <span
                  className={clsx(
                    'size-6 shrink-0',
                    pending === normalizeCode(game.code) ? 'icon-[svg-spinners--180-ring]' : 'icon-[mdi--play]',
                  )}
                />
                <span className='min-w-0 text-left'>
                  <span className='block truncate font-semibold'>
                    {isNASCode(game.code) ? serverGameTitle(game.title) : game.title}
                  </span>
                  <span className='block truncate text-sm text-white/70'>{game.host}</span>
                </span>
              </button>
            ))}
            {games?.length === 0 ? <p className='text-center text-white/70'>{t('playTogether.noGames')}</p> : null}
          </div>

          <form className='flex flex-col items-center gap-3 border-t border-white/15 pt-5' onSubmit={handleCode}>
            <label className='flex flex-col items-center gap-2'>
              <span className='text-sm text-white/70'>{t('playTogether.orCode')}</span>
              <input
                aria-describedby={failure?.typed ? 'guest-code-failure' : undefined}
                aria-invalid={failure?.typed ? true : undefined}
                autoCapitalize='characters'
                autoComplete='off'
                autoCorrect='off'
                className='h-12 w-48 rounded-lg border border-solid border-white/60 bg-black text-center font-mono text-2xl tracking-[0.3em] uppercase'
                data-testid='guest-code'
                maxLength={codeLength + 1}
                onChange={(event) => setCode(event.target.value)}
                readOnly={Boolean(pending)}
                spellCheck={false}
                value={code}
              />
            </label>
            {failure?.typed ? (
              <p className='text-center text-[#ffc46b]' id='guest-code-failure' role='alert'>
                {t(failure.words)}
              </p>
            ) : null}
            <button
              className={pill}
              data-testid='guest-join'
              disabled={Boolean(pending) || code.replaceAll(/\s/gu, '').length < codeLength}
              type='submit'
            >
              {pending && pending === normalizeCode(code) ? (
                <span className='icon-[svg-spinners--180-ring] size-5' />
              ) : null}
              {t('playTogether.joinWithCode')}
            </button>
          </form>
        </div>
      )}

      {/* The top bar, as a game on this device has it: pause at the top left, where the controls leave room for it, and
          the ColecoVision's and Atari 5200's keypad beside it; the on-screen controls' toggle at the top right. A
          guest's pause asks whether to leave */}
      {playing && !overlayOpen ? (
        <>
          <button
            aria-label={onNAS ? t('emulator.pause') : t('pauseMenu.leave')}
            className={clsx(barIcon, 'left-safe')}
            data-testid={onNAS ? 'nas-pause' : 'guest-leave-ask'}
            onClick={pressPause}
            type='button'
          >
            <span className={clsx('size-6', onNAS ? 'icon-[mdi--pause]' : 'icon-[mdi--close]')} />
          </button>
          {showControls && keypad ? (
            <TestSessionProvider emulator={standIn}>
              <VirtualGamepadButton
                aria-label={t('join.keypad')}
                aria-pressed={keypadOpen}
                className={clsx(barIcon, 'left-safe-offset-11', keypadOpen && 'bg-[#ff9a4a] text-[#3a1a00]')}
                onClick={() => setKeypadOpen(!keypadOpen)}
                title={t('join.keypad')}
              >
                <span className='icon-[mdi--dialpad] size-6' />
              </VirtualGamepadButton>
            </TestSessionProvider>
          ) : null}
          {touchControls ? (
            <button
              aria-label={t('join.onScreenControls')}
              aria-pressed={controlsShown}
              className={clsx(barIcon, 'right-safe')}
              data-testid='guest-controls-toggle'
              onClick={() => setControlsShown(!controlsShown)}
              type='button'
            >
              <span className='icon-[mdi--gamepad-square] size-6' />
            </button>
          ) : null}
        </>
      ) : null}

      {/* Before a game is joined, back to the library */}
      {joined ? null : (
        <button
          aria-label={t('common.back')}
          className={clsx(barIcon, 'right-safe-offset-2 top-safe-offset-2')}
          data-sn-enabled
          onClick={goBack}
          type='button'
        >
          <span className='icon-[mdi--close] size-6' />
        </button>
      )}
    </div>
  )
}
