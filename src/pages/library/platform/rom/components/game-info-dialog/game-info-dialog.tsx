import { Button, Dialog } from '@radix-ui/themes'
import type { InferRequestType } from 'hono'
import { type SubmitEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'
import { libraryModeEnum } from '#@/databases/schema.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { DialogRoot } from '#@/pages/library/components/dialog-root.tsx'
import { useLibraryRefresh } from '#@/pages/library/hooks/use-library-refresh.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { GameMediaBoxart } from '../game-media-dialog/game-media-boxart.tsx'
import { GameMediaImages } from '../game-media-dialog/game-media-images.tsx'
import { GameInfoDataList } from './game-info-data-list.tsx'

/**
 * The game page's one Edit button, round like Favorite and Download beside it, and its window for everything about the
 * game: box art, details, description, screenshots and videos. Box art and media are kept as soon as they're changed;
 * the details when Save is pressed. On a phone the window fills the screen
 */
export function GameInfoDialog() {
  const rom = useRom()
  const { t } = useTranslation()
  const { currentUser } = useGlobalLoaderData()
  const refresh = useLibraryRefresh()
  const [open, setOpen] = useState(false)

  const { isMutating, trigger } = useSWRMutation(
    { endpoint: 'roms', method: 'patch', param: { id: rom.id } },
    ({ param }, { arg: form }: { arg: InferRequestType<(typeof client.roms)[':id']['$patch']>['form'] }) =>
      client.roms[':id'].$patch({ form, param }),
  )

  async function handleOpenChange(next: boolean) {
    setOpen(next)
    // Box art and media are kept as they change, so the page catches up when the window closes
    if (!next) {
      await refresh()
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.target)
    await trigger(Object.fromEntries(formData))
    await handleOpenChange(false)
  }

  // Players of a shared library can't change it
  if (currentUser?.libraryMode === libraryModeEnum.shared) {
    return
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger>
        <button
          aria-label={t('common.edit')}
          className='flex rounded-full bg-(--color-background) p-1.5 ring-1 ring-(--gray-4) hover:bg-(--accent-3) hover:ring-(--accent-3)'
          title={t('common.edit')}
          type='button'
        >
          <span className='icon-[mdi--pencil] text-lg text-(--accent-11)' />
        </button>
      </Dialog.Trigger>

      <Dialog.Content aria-describedby={undefined} className='edit-game-dialog' maxWidth='760px'>
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

        <div className='mt-5 flex justify-end gap-3'>
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
