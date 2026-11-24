import { Button, Callout, Flex, Text } from '@radix-ui/themes'
import { useState, type SubmitEvent } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'
import type { Account } from '#@/api/types.ts'
import { AccountFormField } from '#@/pages/components/account-form-field.tsx'
import { minPasswordLength } from '#@/pages/components/min-password-length.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { useAgo } from '#@/pages/library/platform/rom/components/use-ago.ts'
import { AccountAdminControls } from './account-admin-controls.tsx'
import { DeleteOwnAccount } from './delete-own-account.tsx'
import { SignedInDevices } from './signed-in-devices.tsx'

const { $patch } = client.auth.password

interface UserTabContentProps {
  /** The account as the admins' list has it, for an admin: its name and role can then be changed */
  account?: Account
  canDelete: boolean
  /** The user may delete this account, their own: anyone but the library's owner */
  canDeleteOwn?: boolean
  onDelete?: () => void
  user: {
    /** When the account was made and last used, which only the admins' list of accounts has */
    createdAt?: string
    id: string
    lastActivityAt?: null | string
  }
}

export function UserTabContent({
  account,
  canDelete,
  canDeleteOwn = false,
  onDelete,
  user,
}: Readonly<UserTabContentProps>) {
  const { t } = useTranslation()
  const { authMode, currentUser } = useGlobalLoaderData()
  const [passwordError, setPasswordError] = useState<null | string>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetError, setResetError] = useState<null | string>(null)
  const [resetDone, setResetDone] = useState(false)
  const ago = useAgo()

  const isCurrentUser = user.id === currentUser.id

  const { isMutating: isUpdatingPassword, trigger: handleSubmit } = useSWRMutation(
    { endpoint: 'auth/password', method: 'patch' },
    async (_key, { arg: event }: { arg: SubmitEvent<HTMLFormElement> }) => {
      event.preventDefault()
      setPasswordError(null)
      setPasswordSuccess(false)

      const formData = new FormData(event.currentTarget)

      if (formData.get('new_password') !== formData.get('repeat_new_password')) {
        setPasswordError(t('auth.passwordsDoNotMatch'))
        return
      }

      if (formData.get('new_password') === formData.get('password')) {
        setPasswordError(t('auth.samePasswordError'))
        return
      }

      const form = {
        new_password: `${formData.get('new_password')?.toString()}`,
        password: `${formData.get('password')?.toString()}`,
      }

      const formElement = event.currentTarget
      const result = await $patch({ form })
      setPasswordSuccess(true)
      formElement.reset()
      return result
    },
    {
      onError: (err) => {
        setPasswordError(err.message || t('error.unknown'))
      },
    },
  )

  // A new password for someone who forgot theirs, which the admin gives them
  const { isMutating: isResettingPassword, trigger: handleReset } = useSWRMutation(
    { endpoint: `users/${user.id}/password`, method: 'put' },
    async (_key, { arg: event }: { arg: SubmitEvent<HTMLFormElement> }) => {
      event.preventDefault()
      setResetError(null)
      setResetDone(false)
      const formElement = event.currentTarget
      const formData = new FormData(formElement)
      if (formData.get('new_password') !== formData.get('repeat_new_password')) {
        setResetError(t('auth.passwordsDoNotMatch'))
        return
      }
      await client.users[':id'].password.$put({
        form: { new_password: `${formData.get('new_password')?.toString()}` },
        param: { id: user.id },
      })
      setResetDone(true)
      formElement.reset()
    },
    {
      onError: (err) => {
        setResetError(err.message || t('error.unknown'))
      },
      throwOnError: false,
    },
  )

  return (
    <Flex className={isCurrentUser ? '' : 'py-4'} direction='column' gap='4'>
      {user.createdAt ? (
        <Text className='opacity-70' size='2'>
          {t('common.created')}: {ago(user.createdAt)}
          {' · '}
          {t('auth.lastActive')}: {user.lastActivityAt ? ago(user.lastActivityAt) : t('common.never')}
        </Text>
      ) : null}

      {account ? <AccountAdminControls user={account} /> : null}

      {/* What an admin does to someone else's account: a new password, and deleting it */}
      {canDelete ? (
        <>
          {authMode === 'local' && !isCurrentUser ? (
            <form className='flex flex-col gap-2 lg:w-xl' onSubmit={handleReset}>
              <Flex align='center' gap='2'>
                <span className='icon-[mdi--lock-reset]' />
                <Text size='3' weight='bold'>
                  {t('auth.setNewPassword')}
                </Text>
              </Flex>
              <Text className='opacity-70' size='1'>
                {t('auth.setNewPasswordNote')}
              </Text>
              <div className='grid-cols-2 gap-4 lg:grid'>
                <AccountFormField
                  autoComplete='new-password'
                  iconClass='icon-[mdi--password-add]'
                  label={t('auth.newPassword')}
                  minLength={minPasswordLength}
                  name='new_password'
                  required
                  size='2'
                  type='password'
                />
                <AccountFormField
                  autoComplete='new-password'
                  iconClass='icon-[mdi--password-check]'
                  label={t('auth.repeatNewPassword')}
                  name='repeat_new_password'
                  required
                  size='2'
                  type='password'
                />
              </div>
              <Button className='mt-2!' loading={isResettingPassword} type='submit' variant='soft'>
                <span className='icon-[mdi--password-check]' />
                {t('auth.setNewPassword')}
              </Button>
              {resetDone ? (
                <Callout.Root className='mt-2'>
                  <Callout.Icon>
                    <span className='icon-[mdi--check]' />
                  </Callout.Icon>
                  <Callout.Text>{t('auth.passwordSet')}</Callout.Text>
                </Callout.Root>
              ) : null}
              {resetError ? (
                <Callout.Root className='mt-2' color='red'>
                  <Callout.Icon>
                    <span className='icon-[mdi--information]' />
                  </Callout.Icon>
                  <Callout.Text>{resetError}</Callout.Text>
                </Callout.Root>
              ) : null}
            </form>
          ) : null}

          <div className='lg:w-xl'>
            <Button
              className='w-full!'
              color='red'
              disabled={isCurrentUser}
              onClick={onDelete}
              type='button'
              variant='soft'
            >
              <span className='icon-[mdi--delete]' />
              {t('auth.deleteUser')}
            </Button>
          </div>
        </>
      ) : null}

      {/* Password change section - only for current user */}
      {isCurrentUser && authMode === 'local' ? (
        <>
          <Flex align='center' className='pt-4' gap='2'>
            <span className='icon-[mdi--lock-reset]' />
            <Text size='3' weight='bold'>
              {t('auth.changePassword')}
            </Text>
          </Flex>

          <form className='flex flex-col gap-2 lg:w-xl' onSubmit={handleSubmit}>
            <div className='grid-cols-2 grid-rows-2 gap-4 lg:grid'>
              <AccountFormField
                autoComplete='current-password'
                iconClass='icon-[mdi--password]'
                label={t('auth.currentPassword')}
                name='password'
                required
                size='2'
                type='password'
              />
              <AccountFormField
                iconClass='icon-[mdi--password-add]'
                label={t('auth.newPassword')}
                minLength={minPasswordLength}
                name='new_password'
                required
                size='2'
                type='password'
              />
              <AccountFormField
                iconClass='icon-[mdi--password-check]'
                label={t('auth.repeatNewPassword')}
                name='repeat_new_password'
                required
                size='2'
                type='password'
              />
            </div>
            <div className='pl-2 text-xs opacity-50'>{t('auth.passwordRecommendation')}</div>
            <Button className='mt-2!' loading={isUpdatingPassword} type='submit'>
              <span className='icon-[mdi--password-check]' />
              {t('auth.updatePassword')}
            </Button>

            {passwordSuccess ? (
              <Callout.Root className='mt-4'>
                <Callout.Icon>
                  <span className='icon-[mdi--check]' />
                </Callout.Icon>
                <Callout.Text>{t('auth.passwordUpdated')}</Callout.Text>
              </Callout.Root>
            ) : null}

            {passwordError ? (
              <Callout.Root className='mt-4' color='red'>
                <Callout.Icon>
                  <span className='icon-[mdi--information]' />
                </Callout.Icon>
                <Callout.Text>{passwordError}</Callout.Text>
              </Callout.Root>
            ) : null}
          </form>
        </>
      ) : null}
      {isCurrentUser ? <SignedInDevices /> : null}
      {isCurrentUser && canDeleteOwn ? <DeleteOwnAccount /> : null}
    </Flex>
  )
}
