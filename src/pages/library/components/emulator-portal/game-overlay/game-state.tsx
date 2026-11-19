import { clsx } from 'clsx'
import type { InferResponseType } from 'hono'
import { DateTime } from 'luxon'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import type { client } from '#@/api/client.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { dateFormatMap } from '#@/utils/isomorphic/i18n.ts'
import { humanizeDate } from '#@/utils/isomorphic/misc.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { GameStateDelete } from './game-state-delete.tsx'

export function GameState({
  state,
}: Readonly<{ state: Extract<InferResponseType<typeof client.states.$get>, any[]>[number] }>) {
  const { i18n, t } = useTranslation()
  const { preference } = usePreference()
  const { hide, setIsPending } = useGameOverlay()
  const { core, discs, emulator, switchToDisc } = useSession()
  const rom = useRom()
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const { isMutating, trigger: loadState } = useSWRMutation(
    getFileUrl(state.fileId),
    // A save of a game on several discs is loaded with its disc in the drive
    async (url) => {
      if (state.disc && discs.length > 1) {
        await switchToDisc(state.disc)
      }
      await emulator?.loadState(url)
    },
    { onSuccess: hide },
  )

  const loadable = core === state.core
  const disabled = !loadable || isMutating
  const dateFormat = preference.ui.dateFormat === 'auto' ? dateFormatMap[i18n.language] : preference.ui.dateFormat
  const date = humanizeDate(state.createdAt, dateFormat)
  // Downloaded under the game's name and when the state was made, so several downloads don't overwrite each other
  const fileName = `${rom ? getRomGoodcodes(rom).rom : 'state'} ${DateTime.fromJSDate(new Date(state.createdAt)).toFormat('yyyy-MM-dd HH-mm')}.state`
  const ids = { card: `state-${state.id}`, delete: `state-delete-${state.id}`, download: `state-download-${state.id}` }

  async function handleClick() {
    setIsPending(true)
    try {
      await loadState()
    } finally {
      setIsPending(false)
    }
  }

  function handleLoaded() {
    setLoaded(true)
  }

  function handleError() {
    setLoaded(true)
    setErrored(true)
  }

  return (
    <div className='group relative'>
      <button
        className={clsx(
          'game-state flex h-36 w-48 shrink-0 flex-col overflow-hidden rounded-lg border-4 border-(--color-background) bg-(--color-background) shadow',
          { 'cursor-default': isMutating },
        )}
        data-sn-enabled
        data-sn-focus-style={JSON.stringify({
          backgroundColor: 'rgba(255, 255, 255, 0.3)',
        })}
        // With a gamepad or the keyboard, right moves onto the card's download and delete buttons
        data-sn-right={`#${ids.download}`}
        disabled={disabled}
        id={ids.card}
        onClick={handleClick}
        type='button'
      >
        <div
          className={clsx('relative flex w-full flex-1 items-center justify-center bg-black', {
            'opacity-50': !loadable,
          })}
        >
          {loaded ? null : <span className='icon-[svg-spinners--180-ring]' />}
          {errored ? (
            <span className='icon-[mdi--upload] size-10 text-white/40' />
          ) : (
            <img
              alt={state.id}
              className={clsx('absolute inset-0 size-full object-contain transition-opacity', {
                'opacity-0': !loaded,
                'opacity-80': isMutating,
              })}
              loading='lazy'
              onError={handleError}
              onLoad={handleLoaded}
              src={getFileUrl(state.thumbnailFileId)}
            />
          )}
          {loadable ? null : (
            <div className='absolute right-0 bottom-0 rounded-tl-lg bg-black px-1 py-0.5 text-xs text-white'>
              {state.core}
            </div>
          )}
        </div>
        <div
          className={clsx('mt-1 ml-1 flex h-6 w-full items-center justify-start gap-1 text-xs text-(--color-text)', {
            'opacity-50': !loadable,
          })}
        >
          {isMutating ? (
            <span className='icon-[svg-spinners--180-ring] block size-3 text-(--accent-9)' />
          ) : (
            <span className='px-1'>
              {state.disc && discs.length > 1 ? `${t('emulator.disc', { number: state.disc })}, ${date}` : date}
            </span>
          )}
        </div>
      </button>
      {/* Shown on the card under the pointer or the focus; always shown on touch screens, which have no pointer */}
      <div
        className={clsx(
          'absolute top-2.5 right-2.5 flex gap-1.5 transition-opacity',
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
        )}
      >
        <a
          aria-label={t('common.download')}
          className='flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black'
          data-sn-enabled
          data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.5)', borderRadius: '14px' })}
          data-sn-left={`#${ids.card}`}
          data-sn-right={`#${ids.delete}`}
          download={fileName}
          href={getFileUrl(state.fileId)}
          id={ids.download}
          title={t('common.download')}
        >
          <span className='icon-[mdi--download] size-4' />
        </a>
        <GameStateDelete id={state.id} left={`#${ids.download}`} elementId={ids.delete} />
      </div>
    </div>
  )
}
