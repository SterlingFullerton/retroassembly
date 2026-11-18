import { Button, Dialog, IconButton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { DateTime } from 'luxon'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'
import { DialogRoot } from '#@/pages/library/components/dialog-root.tsx'
import { useLibraryRefresh } from '#@/pages/library/hooks/use-library-refresh.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import type { loader } from '#@/pages/routes/library-platform-rom.tsx'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { useAgo } from './use-ago.ts'

export type Snapshot = Awaited<ReturnType<typeof loader>>['states'][number]
export type PickSnapshot = (snapshot: Snapshot, event: MouseEvent<HTMLButtonElement>) => unknown

// How many snapshots the row on the game's page shows; See all shows every one
const shownInRow = 10

/**
 * Has up or down from `from` (See all above the row, the game save's buttons below it) land on the snapshot nearest it
 * across that's mostly in view. Left to itself, the move would pass over the row, since the snapshot straight above or
 * below is the one cut off at the row's edge
 */
export function aimAtSnapshots(from: HTMLElement, direction: 'down' | 'up') {
  const attribute = `data-sn-${direction}`
  const row = document.querySelector('[data-snapshot-row]')
  const shown = row?.getBoundingClientRect()
  const centre = from.getBoundingClientRect().left + from.offsetWidth / 2
  let nearest: HTMLElement | undefined
  let nearestDistance = Infinity
  for (const snapshot of row?.querySelectorAll<HTMLElement>('button[id]') ?? []) {
    const rect = snapshot.getBoundingClientRect()
    const across = Math.min(rect.right, shown?.right ?? 0) - Math.max(rect.left, shown?.left ?? 0)
    const distance = Math.abs(rect.left + rect.width / 2 - centre)
    if (across >= rect.width / 2 && distance < nearestDistance) {
      nearest = snapshot
      nearestDistance = distance
    }
  }
  if (nearest) {
    from.setAttribute(attribute, `#${CSS.escape(nearest.id)}`)
  } else {
    from.removeAttribute(attribute)
  }
}

/**
 * The game's snapshots on its page: their pictures, newest first, each continuing the game from there. See all shows
 * every one, where they can also be downloaded or deleted
 */
export function Snapshots({ disabled, onPick }: Readonly<{ disabled: boolean; onPick: PickSnapshot }>) {
  const { t } = useTranslation()
  const { states } = useLoaderData<typeof loader>()

  return (
    <section className='mt-6' data-sn-section=''>
      {/* With none, the count of 0 says so, and there's no row */}
      <div className='flex items-center gap-2' data-sn-heading=''>
        <h2 className='text-base font-semibold'>{t('emulator.snapshots')}</h2>
        <span className='text-(--gray-11)'>{states.length}</span>
        {states.length > 0 ? <SeeAllSnapshots disabled={disabled} onPick={onPick} /> : null}
      </div>
      {states.length > 0 ? (
        <div className='scrollbar-on-hover mt-2 flex gap-2.5 overflow-x-auto pb-1' data-snapshot-row=''>
          {states.slice(0, shownInRow).map((snapshot) => (
            <SnapshotButton disabled={disabled} key={snapshot.id} onPick={onPick} snapshot={snapshot} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SnapshotButton({
  disabled,
  onPick,
  snapshot,
}: Readonly<{ disabled: boolean; onPick: PickSnapshot; snapshot: Snapshot }>) {
  const { t } = useTranslation()
  const ago = useAgo()
  const time = ago(snapshot.createdAt)

  return (
    <button
      aria-label={t('emulator.continueFrom', { time })}
      className='group w-28 shrink-0 text-left text-xs text-(--gray-11) disabled:opacity-60'
      disabled={disabled}
      id={`snapshot-${snapshot.id}`}
      onClick={(event) => onPick(snapshot, event)}
      // How long ago is worked out again in the browser, a moment after the server did
      suppressHydrationWarning
      title={t('emulator.continueFrom', { time })}
      type='button'
    >
      <img
        alt=''
        className='mb-1 block aspect-4/3 w-28 rounded-md bg-black object-cover ring-(--accent-9) group-hover:ring-2'
        loading='lazy'
        src={getFileUrl(snapshot.thumbnailFileId)}
      />
      <span suppressHydrationWarning>{time}</span>
    </button>
  )
}

function SeeAllSnapshots({ disabled, onPick }: Readonly<{ disabled: boolean; onPick: PickSnapshot }>) {
  const { t } = useTranslation()
  const { states } = useLoaderData<typeof loader>()
  const [open, setOpen] = useState(false)

  function pick(snapshot: Snapshot, event: MouseEvent<HTMLButtonElement>) {
    setOpen(false)
    return onPick(snapshot, event)
  }

  return (
    <DialogRoot onOpenChange={setOpen} open={open}>
      <Dialog.Trigger>
        <button
          className='ml-auto flex min-h-6 items-center text-sm font-semibold text-(--accent-11) hover:underline'
          onFocus={(event) => aimAtSnapshots(event.currentTarget, 'down')}
          type='button'
        >
          {t('home.seeAll')}
          <span className='icon-[mdi--chevron-right] size-4' />
        </button>
      </Dialog.Trigger>
      <Dialog.Content aria-describedby={undefined} maxWidth='720px'>
        <Dialog.Title>
          {t('emulator.snapshots')} <span className='font-normal text-(--gray-11)'>{states.length}</span>
        </Dialog.Title>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
          {states.map((snapshot) => (
            <SnapshotCard disabled={disabled} key={snapshot.id} onPick={pick} snapshot={snapshot} />
          ))}
        </div>
        <div className='mt-4 flex justify-end'>
          <Dialog.Close>
            <Button variant='soft'>{t('common.close')}</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </DialogRoot>
  )
}

// A snapshot in See all: its picture continues from it; download and delete show on it under the pointer or the
// focus, and always on touch screens, which have no pointer
function SnapshotCard({
  disabled,
  onPick,
  snapshot,
}: Readonly<{ disabled: boolean; onPick: PickSnapshot; snapshot: Snapshot }>) {
  const { t } = useTranslation()
  const { rom } = useLoaderData<typeof loader>()
  const refresh = useLibraryRefresh()
  const ago = useAgo()
  const time = ago(snapshot.createdAt)
  // Downloaded under the game's name and when the snapshot was taken, so several downloads don't overwrite each other
  const fileName = `${getRomGoodcodes(rom).rom} ${DateTime.fromJSDate(new Date(snapshot.createdAt)).toFormat('yyyy-MM-dd HH-mm')}.state`

  const { isMutating: isDeleting, trigger: remove } = useSWRMutation(
    { endpoint: 'states', method: 'delete', param: { id: snapshot.id } },
    async () => {
      await client.states[':id'].$delete({ param: { id: snapshot.id } })
      await refresh()
    },
  )

  async function handleDelete() {
    if (confirm(`${t('dialog.confirmDeleteTitle')}?`)) {
      await remove()
    }
  }

  return (
    <div className='group relative text-xs text-(--gray-11)'>
      <button
        aria-label={t('emulator.continueFrom', { time })}
        className='block w-full text-left disabled:opacity-60'
        disabled={disabled || isDeleting}
        onClick={(event) => onPick(snapshot, event)}
        title={t('emulator.continueFrom', { time })}
        type='button'
      >
        <img
          alt=''
          className='mb-1 block aspect-4/3 w-full rounded-md bg-black object-cover ring-(--accent-9) group-hover:ring-2'
          loading='lazy'
          src={getFileUrl(snapshot.thumbnailFileId)}
        />
        {time}
      </button>
      <div
        className={clsx(
          'absolute top-1.5 right-1.5 flex gap-1 transition-opacity',
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
        )}
      >
        <IconButton asChild size='1'>
          <a
            aria-label={t('common.download')}
            title={t('common.download')}
            download={fileName}
            href={getFileUrl(snapshot.fileId)}
          >
            <span className='icon-[mdi--download] size-4' />
          </a>
        </IconButton>
        <IconButton
          aria-label={t('common.delete')}
          loading={isDeleting}
          onClick={handleDelete}
          size='1'
          title={t('common.delete')}
        >
          <span className='icon-[mdi--delete] size-4' />
        </IconButton>
      </div>
    </div>
  )
}
