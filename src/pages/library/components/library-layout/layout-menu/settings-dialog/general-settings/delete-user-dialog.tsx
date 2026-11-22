import { AlertDialog, Button } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'

interface DeleteUserDialogProps {
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  open: boolean
  userId: string
}

export function DeleteUserDialog({ onOpenChange, onSuccess, open, userId }: Readonly<DeleteUserDialogProps>) {
  const { t } = useTranslation()

  // Said in the dialog, which stays open: the user wasn't deleted
  const { error, isMutating, reset, trigger } = useSWRMutation(
    { endpoint: `users/${userId}`, method: 'delete' },
    () =>
      client.users[':id'].$delete({
        param: { id: userId },
      }),
    {
      onSuccess: () => {
        onSuccess()
        onOpenChange(false)
      },
      throwOnError: false,
    },
  )

  return (
    <AlertDialog.Root
      onOpenChange={(next) => {
        reset()
        onOpenChange(next)
      }}
      open={open}
    >
      <AlertDialog.Content>
        <AlertDialog.Title>
          <div className='flex items-center'>
            <span className='icon-[mdi--delete] mr-2' />
            {t('auth.deleteUser')}
          </div>
        </AlertDialog.Title>
        <AlertDialog.Description>{t('dialog.confirmActionMessage')}</AlertDialog.Description>
        {error ? (
          <p className='mt-3 flex items-center gap-2 text-sm text-(--red-11)' role='alert'>
            <span className='icon-[mdi--alert-circle-outline] shrink-0' />
            {t('error.deleteFailed')}
          </p>
        ) : null}
        <div className='mt-4 flex justify-end gap-3'>
          <AlertDialog.Cancel>
            <Button disabled={isMutating} variant='soft'>
              <span className='icon-[mdi--close]' />
              {t('common.cancel')}
            </Button>
          </AlertDialog.Cancel>
          <Button color='red' loading={isMutating} onClick={() => trigger()} variant='soft'>
            <span className='icon-[mdi--delete]' />
            {t('common.delete')}
          </Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
