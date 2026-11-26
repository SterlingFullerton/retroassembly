import { useEffect } from 'react'
import { resolveConsole } from '#@/consoles/registry.ts'
import { startSharing, stopSharing } from '#@/emulator/play-together-session.ts'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePlayTogetherSwitch, useSharing } from '#@/pages/library/hooks/use-play-together.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'

// Playing together, from the host's side: in the pause menu's settings, a button that shares the running game and
// shows the code a guest joins by. An experiment, shown only where its switch is on, with its words in English

const button =
  'flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 px-4 text-white transition-colors hover:bg-white/15'
const focusStyle = JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })

/** Ends the sharing when the game does. It's part of the game's screen, so it's there for as long as the game is */
export function PlayTogetherLifetime() {
  const [launched] = useEmulatorLaunched()
  useEffect(() => {
    if (launched) {
      return stopSharing
    }
  }, [launched])
  return null
}

export function GameOverlayPlayTogether() {
  const [enabled] = usePlayTogetherSwitch()
  const sharing = useSharing()
  const { core, emulator } = useSession()
  const rom = useRom()
  if (!enabled || !emulator || !rom) {
    return null
  }

  async function share() {
    if (emulator && rom) {
      await startSharing({
        controls: resolveConsole(rom.platform, core).controls,
        emulator,
        title: getRomGoodcodes(rom).rom,
      })
    }
  }

  const idle = sharing.stage === 'idle' || sharing.stage === 'failed'
  return (
    <section className='game-overlay-peek-dim flex flex-col gap-2' data-testid='play-together'>
      <h3 className='text-sm font-semibold tracking-wide text-white/70 uppercase'>Play together</h3>
      {sharing.stage === 'inviting' ? (
        <div>
          <div className='text-sm text-white/70'>Code for the other player</div>
          <div className='font-mono text-3xl font-semibold tracking-[0.3em]' data-testid='play-together-code'>
            {sharing.code}
          </div>
          <div className='text-sm text-white/70'>Waiting for them to join. Resume the game when they have.</div>
        </div>
      ) : null}
      {sharing.stage === 'connected' ? <div className='text-sm'>A player has joined as player 2.</div> : null}
      {sharing.stage === 'starting' ? <div className='text-sm text-white/70'>Getting a code.</div> : null}
      {sharing.stage === 'failed' ? <div className='text-sm text-[#ffc46b]'>Couldn’t share the game.</div> : null}
      <div className='flex'>
        <button
          className={button}
          data-sn-enabled
          data-sn-focus-style={focusStyle}
          onClick={idle ? share : stopSharing}
          type='button'
        >
          <span className={idle ? 'icon-[mdi--account-multiple-plus] size-5' : 'icon-[mdi--close] size-5'} />
          <span className='text-[15px]'>{idle ? 'Invite a player' : 'Stop sharing'}</span>
        </button>
      </div>
    </section>
  )
}
