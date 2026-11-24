import { Button, Dialog } from '@radix-ui/themes'
import { type SubmitEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client, type InferRequestType } from '#@/api/client.ts'
import { usePristine } from '#@/pages/library/atoms.ts'
import { DialogRoot } from '#@/pages/library/components/dialog-root.tsx'
import { useLibraryRefresh } from '#@/pages/library/hooks/use-library-refresh.ts'
import { usePermissions } from '#@/pages/library/hooks/use-permissions.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { GameMediaBoxart } from '../game-media-dialog/game-media-boxart.tsx'
import { GameMediaImages } from '../game-media-dialog/game-media-images.tsx'
import { GameInfoDataList } from './game-info-data-list.tsx'

// The first field has the focus as the window opens, not the box art. On a touch screen nothing does, so the keyboard
// doesn't cover the window, unless the arrow keys or a controller are being used (`pristine` is false), as on a Steam Deck
function focusOnOpen(event: Event, pristine: boolean) {
  event.preventDefault()
  const content = event.currentTarget as HTMLElement
  if (pristine && matchMedia('(pointer: coarse)').matches) {
    content.focus()
  } else {
    content.querySelector<HTMLElement>('#edit-game-form input')?.focus()
  }
}

/**
 * The game page's one Edit button, round like Favorite and Download beside it, and its window for everything about the
 * game: box art, details, description, screenshots and videos. Box art and media are kept as soon as they're changed;
 * the details when Save is pressed, and only then. On a phone the window fills the screen
 */
export function GameInfoDialog() {
  const rom = useRom()
  const { t } = useTranslation()
  const { canAddGames } = usePermissions()
  const refresh = useLibraryRefresh()
  const [open, setOpen] = useState(false)
  const [pristine] = usePristine()
  const [failed, setFailed] = useState(false)

  const { isMutating, trigger } = useSWRMutation(
    { endpoint: 'roms', method: 'patch', param: { id: rom.id } },
    ({ param }, { arg: form }: { arg: InferRequestType<(typeof client.roms)[':id']['$patch']>['form'] }) =>
      client.roms[':id'].$patch({ form, param }),
  )

  async function handleOpenChange(next: boolean) {
    setOpen(next)
    setFailed(false)
    // Box art and media are kept as they change, so the page catches up when the window closes
    if (!next) {
      await refresh()
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.target)
    setFailed(false)
    // A save that doesn't go through keeps the window open, with what was typed, to try again
    try {
      const response = await trigger(Object.fromEntries(formData))
      if (!response.ok) {
        setFailed(true)
        return
      }
    } catch {
      setFailed(true)
      return
    }
    await handleOpenChange(false)
  }

  // Editing a game is for contributors and admins
  if (!canAddGames) {
    return
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger>
        <button
          aria-label={t('common.edit')}
          className='flex size-10 shrink-0 items-center justify-center rounded-full bg-(--color-background) ring-1 ring-(--gray-4) hover:bg-(--accent-3) hover:ring-(--accent-3) md:size-auto md:p-1.5'
          title={t('common.edit')}
          type='button'
        >
          <span className='icon-[mdi--pencil] text-lg text-(--accent-11)' />
        </button>
      </Dialog.Trigger>

      <Dialog.Content
        aria-describedby={undefined}
        className='edit-game-dialog'
        maxWidth='760px'
        onOpenAutoFocus={(event) => focusOnOpen(event, pristine)}
      >
        <Dialog.Title>{t('game.editGame')}</Dialog.Title>

        <div className='edit-game-scroll'>
          <div className='flex flex-col gap-5 sm:flex-row'>
            <div className='shrink-0 sm:w-40'>
              <div className='mb-1 text-xs text-(--gray-11)'>{t('game.media.boxArt')}</div>
              <GameMediaBoxart />
            </div>

            <form autoComplete='off' className='min-w-0 flex-1' id='edit-game-form' onSubmit={handleSubmit}>
              <GameInfoDataList />
            </form>
          </div>

          <div className='mt-5'>
            <div className='mb-1 text-xs text-(--gray-11)'>{t('game.media.media')}</div>
            <GameMediaImages />
          </div>
        </div>

        <div className='mt-5 flex items-center justify-end gap-3'>
          {failed ? (
            <span className='mr-auto text-sm text-(--red-11)' role='alert'>
              {t('game.saveFailed')}
            </span>
          ) : null}
          <Dialog.Close>
            <Button disabled={isMutating} type='button' variant='soft'>
              {t('common.cancel')}
            </Button>
          </Dialog.Close>
          <Button form='edit-game-form' loading={isMutating} type='submit'>
            {t('common.save')}
          </Button>
        </div>

        <div className='settings-close absolute top-6 right-6'>
          <Dialog.Close>
            <Button aria-label={t('common.close')} type='button' variant='ghost'>
              <span className='icon-[mdi--close] size-5' />
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </DialogRoot>
  )
}
