import { Button, Callout, Dialog } from '@radix-ui/themes'
import { useState, type SubmitEvent } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client, parseResponse } from '#@/api/client.ts'
import { AccountFormField } from '#@/pages/components/account-form-field.tsx'
import { minPasswordLength } from '#@/pages/components/min-password-length.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { RolePicker } from './role-picker.tsx'

interface CreateUserDialogProps {
  onOpenChange: (open: boolean) => void
  onSuccess: (newUserId?: string) => void
  open: boolean
}

export function CreateUserDialog({ onOpenChange, onSuccess, open }: Readonly<CreateUserDialogProps>) {
  const { t } = useTranslation()
  const { authMode } = useGlobalLoaderData()
  const [error, setError] = useState<null | string>(null)

  const { isMutating, trigger } = useSWRMutation(
    { endpoint: 'users', method: 'post' },
    async (_key, { arg }: { arg: { password?: string; role: string; username: string } }) => {
      setError(null)
      return await parseResponse(
        client.users.$post({
          form: { password: arg.password, role: arg.role, username: arg.username },
        }),
      )
    },
    {
      onError: (err) => {
        setError(err.message || t('error.unknown'))
      },
      onSuccess: (result) => {
        onSuccess(result?.id)
        onOpenChange(false)
      },
    },
  )

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const username = formData.get('username')?.toString() || ''
    const password = formData.get('password')?.toString()
    const role = formData.get('role')?.toString() || 'player'
    if (authMode === 'local' && formData.get('password') !== formData.get('repeat_password')) {
      setError(t('auth.passwordsDoNotMatch'))
      return
    }

    await trigger({ password, role, username })
  }

  function handleOpenChange(open: boolean) {
    if (!isMutating) {
      setError(null)
      onOpenChange(open)
    }
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Content>
        <Dialog.Title>
          <div className='flex items-center'>
            <span className='icon-[mdi--account-plus] mr-2' />
            {t('auth.createNewUser')}
          </div>
        </Dialog.Title>
        <form onSubmit={handleSubmit}>
          <div className='my-4 flex flex-col gap-4'>
            <AccountFormField
              iconClass='icon-[mdi--user-card-details]'
              label={t('auth.username')}
              name='username'
              required
            />
            {authMode === 'local' ? (
              <>
                <AccountFormField
                  autocomplete='new-password'
                  description={t('auth.passwordRecommendation')}
                  iconClass='icon-[mdi--password]'
                  label={t('auth.password')}
                  minLength={minPasswordLength}
                  name='password'
                  required
                  type='password'
                />
                <AccountFormField
                  autocomplete='new-password'
                  iconClass='icon-[mdi--password-check]'
                  label={t('auth.repeatPassword')}
                  name='repeat_password'
                  required
                  type='password'
                />
              </>
            ) : null}
            <RolePicker defaultValue='player' name='role' />
          </div>
          {error ? (
            <Callout.Root className='mb-4' color='red'>
              <Callout.Icon>
                <span className='icon-[mdi--information]' />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          ) : null}
          <div className='flex justify-end gap-3'>
            <Dialog.Close>
              <Button disabled={isMutating} variant='soft'>
                <span className='icon-[mdi--close]' />
                {t('common.cancel')}
              </Button>
            </Dialog.Close>
            <Button loading={isMutating} type='submit'>
              <span className='icon-[mdi--account-plus]' />
              {t('auth.createUser')}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
