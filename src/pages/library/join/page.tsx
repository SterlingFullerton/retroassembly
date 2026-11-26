import { type SubmitEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { connectGuestOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { findInvitation } from '#@/emulator/play-together-signal.ts'
import { encodePadState, joinGame } from '#@/emulator/play-together.ts'
import { getKeyButtons, mergePads } from '#@/input/guest-pad.ts'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { TestSessionProvider } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { ConsoleControls } from '#@/pages/library/components/emulator-portal/game-overlay/console-controls.tsx'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'
import { routes } from '#@/pages/routes.ts'

// A guest's side of a game played together: the host's game, as a picture and sound sent from their device, with this
// device's keys, controller or on-screen controls playing as the next player. An experiment, reached only by its
// address; its words are in English until it's decided whether to keep it

// The controller is sent when it changes, and again this often in case a message was lost on the way
const resendEvery = 100
const sendEvery = 16

type Stage = 'asking' | 'ended' | 'looking' | 'playing'

type Found = Awaited<ReturnType<typeof findInvitation>>

const codeLength = 6

/** The first real controller connected to this device */
function getController() {
  return [...(navigator.getGamepads?.() ?? [])].find((gamepad) => gamepad?.connected)
}

export default function JoinPage() {
  const navigate = useNavigate()
  const keyboard = useKeyboardMapping()
  const [stage, setStage] = useState<Stage>('asking')
  const [code, setCode] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [found, setFound] = useState<Found>()
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

  // Joining is the guest's own touch or click, which sound can't start without
  async function handleJoin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotFound(false)
    setStage('looking')
    try {
      setFound(await findInvitation(code))
      setStage('playing')
    } catch {
      setNotFound(true)
      setStage('asking')
    }
  }

  const playing = stage === 'playing'
  useEffect(() => {
    if (!playing || !found) {
      return
    }
    let closed = false
    let timer: ReturnType<typeof setInterval> | undefined
    let session: Awaited<ReturnType<typeof joinGame>> | undefined
    async function join(joining: Found) {
      session = await joinGame({
        offer: joining.invitation.offer,
        onStream(stream) {
          if (video.current) {
            video.current.srcObject = stream
          }
        },
      })
      if (closed) {
        session.close()
        return
      }
      const { connection } = session
      connection.addEventListener('connectionstatechange', () => {
        if (['closed', 'disconnected', 'failed'].includes(connection.connectionState)) {
          setStage('ended')
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
    // A game that can't be reached is one that ended
    // oxlint-disable-next-line promise/prefer-await-to-then -- an effect can't wait
    join(found).catch(() => setStage('ended'))
    return () => {
      closed = true
      clearInterval(timer)
      session?.close()
    }
  }, [playing, found, onScreen])

  useEffect(() => {
    if (!playing) {
      return
    }
    const keys = getKeyButtons(keyboard)
    const abortController = new AbortController()
    function handleKey(event: KeyboardEvent) {
      const button = keys.get(getKeyNameFromCode(event.code))
      if (button) {
        event.preventDefault()
        if (event.type === 'keydown') {
          keysHeld.current.add(button)
        } else {
          keysHeld.current.delete(button)
        }
      }
    }
    document.addEventListener('keydown', handleKey, { signal: abortController.signal })
    document.addEventListener('keyup', handleKey, { signal: abortController.signal })
    return () => abortController.abort()
  }, [playing, keyboard])

  async function leave() {
    await navigate(routes.libraryHome)
  }

  return (
    <div className='fixed inset-0 z-20 flex touch-none items-center justify-center bg-black text-white'>
      {/* The game: its picture kept whole, and its sound */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a game's picture and sound, which has no words to caption */}
      <video
        autoPlay
        className={playing ? 'size-full object-contain' : 'hidden'}
        data-testid='guest-video'
        playsInline
        ref={video}
      />

      {playing && touch && found ? (
        <TestSessionProvider emulator={standIn}>
          <div className='pointer-events-none absolute inset-0 *:pointer-events-auto'>
            <ConsoleControls kind={found.invitation.controls} />
          </div>
        </TestSessionProvider>
      ) : null}

      {playing ? null : (
        <div className='flex flex-col items-center gap-4 p-6 text-center'>
          {stage === 'ended' ? <p>The game ended.</p> : null}
          <form className='flex flex-col items-center gap-4' onSubmit={handleJoin}>
            <label className='flex flex-col items-center gap-2'>
              <span>Code from the player sharing a game</span>
              <input
                autoCapitalize='characters'
                autoComplete='off'
                autoCorrect='off'
                className='h-14 w-56 rounded-lg border border-solid border-white bg-black text-center font-mono text-3xl tracking-[0.3em] uppercase'
                data-testid='guest-code'
                maxLength={codeLength + 1}
                onChange={(event) => setCode(event.target.value)}
                spellCheck={false}
                value={code}
              />
            </label>
            {notFound ? <p className='text-[#ffc46b]'>No game to join by that code.</p> : null}
            <button
              className='h-12 rounded-full border border-solid border-white px-6 hover:bg-white/15 disabled:opacity-50'
              data-testid='guest-join'
              disabled={stage === 'looking' || code.replaceAll(/\s/gu, '').length < codeLength}
              type='submit'
            >
              Join
            </button>
          </form>
        </div>
      )}

      <button
        aria-label='Leave'
        className='top-safe-offset-2 right-safe-offset-2 absolute flex size-11 items-center justify-center rounded-full hover:bg-white/15'
        onClick={leave}
        type='button'
      >
        <span className='icon-[mdi--close] size-6' />
      </button>
    </div>
  )
}
