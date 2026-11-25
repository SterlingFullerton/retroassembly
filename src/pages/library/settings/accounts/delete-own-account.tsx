import { AlertDialog, Button } from '@radix-ui/themes'
import { type SubmitEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { client } from '#@/api/client.ts'
import { AccountFormField } from '#@/pages/components/account-form-field.tsx'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'

/** Deletes the signed-in user's own account, once they've given their password, and leaves for the login page */
export function DeleteOwnAccount() {
  const { t } = useTranslation()
  const { authMode } = useGlobalLoaderData()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const password = new FormData(event.currentTarget).get('password')?.toString()
      await client.users.current.delete.$post({ form: { password } })
      location.replace('/login')
    } catch (error) {
      // Said in the dialog, which stays open: the account wasn't deleted
      setError((error as { message?: string })?.message || t('error.deleteFailed'))
      setBusy(false)
    }
  }

  return (
    <div className='lg:w-xl'>
      <Button className='w-full!' color='red' onClick={() => setOpen(true)} type='button' variant='soft'>
        <span className='icon-[mdi--delete]' />
        {t('auth.deleteMyAccount')}
      </Button>
      <AlertDialog.Root
        onOpenChange={(next) => {
          if (!busy) {
            setError(null)
            setOpen(next)
          }
        }}
        open={open}
      >
        <AlertDialog.Content>
          <AlertDialog.Title>
            <div className='flex items-center'>
              <span className='icon-[mdi--delete] mr-2' />
              {t('auth.deleteMyAccount')}
            </div>
          </AlertDialog.Title>
          <AlertDialog.Description>{t('auth.deleteAccountWarning')}</AlertDialog.Description>
          <form className='mt-4 flex flex-col gap-4' onSubmit={handleSubmit}>
            {authMode === 'local' ? (
              <AccountFormField
                autoComplete='current-password'
                iconClass='icon-[mdi--password]'
                label={t('auth.currentPassword')}
                name='password'
                required
                size='2'
                type='password'
              />
            ) : null}
            {error ? (
              <p className='flex items-center gap-2 text-sm text-(--red-11)' role='alert'>
                <span className='icon-[mdi--alert-circle-outline] shrink-0' />
                {error}
              </p>
            ) : null}
            <div className='flex justify-end gap-3'>
              <AlertDialog.Cancel>
                <Button disabled={busy} type='button' variant='soft'>
                  <span className='icon-[mdi--close]' />
                  {t('common.cancel')}
                </Button>
              </AlertDialog.Cancel>
              <Button color='red' loading={busy} type='submit' variant='soft'>
                <span className='icon-[mdi--delete]' />
                {t('common.delete')}
              </Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  )
}
