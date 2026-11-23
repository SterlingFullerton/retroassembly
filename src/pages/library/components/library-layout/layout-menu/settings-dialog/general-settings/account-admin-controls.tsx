import { Button, Checkbox, Text, TextField } from '@radix-ui/themes'
import { type SubmitEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'
import { client } from '#@/api/client.ts'
import type { Account } from '#@/api/types.ts'

function messageOf(error: unknown, fallback: string) {
  return (error as { message?: string })?.message || fallback
}

/**
 * What an admin changes about an account besides its library: its name, and whether it's an admin too. The library's
 * owner keeps their role, so only their name is offered
 */
export function AccountAdminControls({ user }: Readonly<{ user: Account }>) {
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  // Said under the controls, which go back to what the account still has
  async function change(form: { role?: string; username?: string }) {
    setBusy(true)
    setError(null)
    try {
      await client.users[':id'].$patch({ form, param: { id: user.id } })
      await mutate({ endpoint: 'users', method: 'get' })
    } catch (error) {
      setError(messageOf(error, t('error.unknown')))
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const username = new FormData(event.currentTarget).get('username')?.toString().trim() ?? ''
    if (username && username !== user.username) {
      await change({ username })
    }
  }

  return (
    <div className='flex flex-col gap-4 lg:w-xl'>
      <form className='flex items-end gap-2' onSubmit={handleRename}>
        <label className='min-w-0 flex-1'>
          <div className='mb-2 text-sm font-medium'>{t('auth.username')}</div>
          {/* Keyed by the name, so the box shows the new one once it's saved */}
          <TextField.Root
            autoComplete='off'
            defaultValue={user.username}
            key={user.username}
            maxLength={32}
            minLength={2}
            name='username'
            required
            size='2'
          >
            <TextField.Slot>
              <span className='icon-[mdi--user-card-details]' />
            </TextField.Slot>
          </TextField.Root>
        </label>
        <Button disabled={busy} type='submit' variant='soft'>
          <span className='icon-[mdi--rename]' />
          {t('auth.rename')}
        </Button>
      </form>

      {user.isSuper ? null : (
        <label className='flex cursor-pointer items-start gap-2'>
          <Checkbox
            checked={user.role === 'admin'}
            disabled={busy}
            name='role'
            onCheckedChange={(checked) => change({ role: checked ? 'admin' : 'user' })}
          />
          <div className='flex flex-col'>
            <Text size='2' weight='medium'>
              {t('auth.admin')}
            </Text>
            <Text className='opacity-70' size='1'>
              {t('auth.adminDescription')}
            </Text>
          </div>
        </label>
      )}

      {error ? (
        <Text as='p' color='red' role='alert' size='2'>
          {error}
        </Text>
      ) : null}
    </div>
  )
}
