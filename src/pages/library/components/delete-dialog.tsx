import { AlertDialog, Button } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLibraryRefresh } from '../hooks/use-library-refresh.ts'

interface DeleteDialogProps extends AlertDialog.RootProps {
  description: string
  /** Deletes what the dialog is about; the library is refreshed after */
  onConfirm: () => Promise<unknown>
  /** Runs after the deletion and the refresh, for example to clear a selection */
  onDeleted?: () => Promise<void> | void
  title: string
}

/** Asks before deleting games, or removing them from the play history, then brings the library up to date */
export function DeleteDialog({ description, onConfirm, onDeleted, title, ...props }: Readonly<DeleteDialogProps>) {
  const { t } = useTranslation()
  const refresh = useLibraryRefresh()
  const [deleting, setDeleting] = useState(false)
  // Said in the dialog, which stays open: nothing was deleted
  const [failed, setFailed] = useState(false)

  async function handleClickConfirmDelete() {
    setDeleting(true)
    setFailed(false)
    try {
      await onConfirm()
    } catch {
      setDeleting(false)
      setFailed(true)
      return
    }
    props.onOpenChange?.(false)
    await refresh()
    await onDeleted?.()
    setDeleting(false)
  }

  return (
    <AlertDialog.Root {...props}>
      <AlertDialog.Content maxWidth='450px'>
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description className='leading-loose! whitespace-pre-line' size='2'>
          {description}
        </AlertDialog.Description>
        {failed ? (
          <p className='mt-3 flex items-center gap-2 text-sm text-(--red-11)' role='alert'>
            <span className='icon-[mdi--alert-circle-outline] shrink-0' />
            {t('error.deleteFailed')}
          </p>
        ) : null}

        <div className='mt-4 flex justify-end gap-3'>
          <AlertDialog.Cancel>
            <Button disabled={deleting} onClick={() => setFailed(false)}>
              <span className='icon-[mdi--close]' />
              {t('common.cancel')}
            </Button>
          </AlertDialog.Cancel>
          <Button loading={deleting} onClick={handleClickConfirmDelete} variant='soft'>
            <span className='icon-[mdi--delete]' />
            {t('common.delete')}
          </Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
