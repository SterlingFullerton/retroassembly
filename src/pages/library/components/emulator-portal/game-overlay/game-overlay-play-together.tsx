import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConsole } from '#@/consoles/registry.ts'
import { startSharing, stopSharing } from '#@/emulator/play-together-session.ts'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useSharing } from '#@/pages/library/hooks/use-play-together.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'

// Playing together, from the host's side: in the pause menu's Play together page, a button that shares the running game and
// shows the code a guest joins by

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
  const { t } = useTranslation()
  const sharing = useSharing()
  const { core, emulator } = useSession()
  const rom = useRom()
  if (!emulator || !rom) {
    return null
  }

  async function share() {
    if (emulator && rom) {
      await startSharing({
        controls: resolveConsole(rom.platform, core).controls,
        core,
        emulator,
        platform: rom.platform,
        title: getRomGoodcodes(rom).rom,
      })
    }
  }

  const idle = sharing.stage === 'idle' || sharing.stage === 'failed'
  return (
    <section className='game-overlay-peek-dim flex flex-col gap-2' data-testid='play-together'>
      {sharing.stage === 'inviting' && !sharing.listed ? (
        <div>
          <div className='text-sm text-white/70'>{t('playTogether.codeFor')}</div>
          <div className='font-mono text-3xl font-semibold tracking-[0.3em]' data-testid='play-together-code'>
            {sharing.code}
          </div>
        </div>
      ) : null}
      {sharing.stage === 'inviting' ? (
        <div className='text-sm text-white/70' data-testid='play-together-waiting'>
          {sharing.listed
            ? t('playTogether.waitingListed', { joinGame: t('nav.joinGame') })
            : t('playTogether.waitingCode')}
        </div>
      ) : null}
      {sharing.stage === 'connected' ? <div className='text-sm'>{t('playTogether.connected')}</div> : null}
      {sharing.stage === 'starting' ? <div className='text-sm text-white/70'>{t('playTogether.starting')}</div> : null}
      {sharing.stage === 'failed' ? <div className='text-sm text-[#ffc46b]'>{t('playTogether.failed')}</div> : null}
      <div className='flex'>
        <button
          className={button}
          data-sn-enabled
          data-sn-focus-style={focusStyle}
          onClick={idle ? share : stopSharing}
          type='button'
        >
          <span className={idle ? 'icon-[mdi--account-multiple-plus] size-5' : 'icon-[mdi--close] size-5'} />
          <span className='text-[15px]'>{idle ? t('playTogether.invite') : t('playTogether.stop')}</span>
        </button>
      </div>
    </section>
  )
}
