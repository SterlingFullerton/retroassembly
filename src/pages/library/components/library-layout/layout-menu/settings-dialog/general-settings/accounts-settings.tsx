import { Badge, Callout } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouteLoaderData } from 'react-router'
import useSWR, { useSWRConfig } from 'swr'
import { client, parseResponse } from '#@/api/client.ts'
import { Tabs } from '#@/pages/components/tabs.tsx'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { CreateUserDialog } from './create-user-dialog.tsx'
import { DeleteUserDialog } from './delete-user-dialog.tsx'
import { UserTabContent } from './user-tab-content.tsx'

const roleNames = { admin: 'auth.admin', contributor: 'auth.contributor', player: 'auth.player' }

export function AccountsSettings() {
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()
  const { currentUser } = useGlobalLoaderData()
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUser.id)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Only the admin may list every account, so no one else asks
  const isAdmin = Boolean(useRouteLoaderData('library')?.isAdmin)
  const { data: users, error: usersError } = useSWR(isAdmin ? { endpoint: 'users', method: 'get' } : null, () =>
    parseResponse(client.users.$get()),
  )

  // Everyone else has only their own account: its password, where they're signed in, and deleting it
  if (!isAdmin) {
    return (
      <div>
        <SettingsTitle>{t('common.accounts')}</SettingsTitle>
        <div>
          <UserTabContent canDelete={false} canDeleteOwn user={currentUser} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <SettingsTitle>{t('common.accounts')}</SettingsTitle>

      {usersError ? (
        <Callout.Root className='mb-4' color='red'>
          <Callout.Icon>
            <span className='icon-[mdi--information]' />
          </Callout.Icon>
          <Callout.Text>{usersError.message || t('error.unknown')}</Callout.Text>
        </Callout.Root>
      ) : null}

      {/* Super users: Show tabs with users */}
      <div>
        <Tabs.Root onValueChange={setSelectedUserId} value={selectedUserId || currentUser.id}>
          <Tabs.List wrap='wrap'>
            {users?.map((user) => (
              <Tabs.Trigger key={user.id} value={user.id}>
                <span className='icon-[mdi--account] mr-2' />
                {user.username}
                {user.id === currentUser.id ? (
                  <Badge color='grass' ml='2' size='1'>
                    {t('common.current')}
                  </Badge>
                ) : null}
                {user.isSuper ? (
                  <Badge color='amber' ml='2' size='1'>
                    {t('auth.owner')}
                  </Badge>
                ) : null}
                {user.isSuper ? null : (
                  <Badge color='gray' ml='2' size='1'>
                    {t(roleNames[user.role] ?? roleNames.player)}
                  </Badge>
                )}
              </Tabs.Trigger>
            ))}
            <Tabs.Trigger
              className='cursor-pointer'
              onClick={(e) => {
                e.preventDefault()
                setCreateDialogOpen(true)
              }}
              onMouseDown={(e) => e.preventDefault()}
              value='+'
            >
              <span className='icon-[mdi--plus]' />
              <span className='ml-1'>{t('auth.addUser')}</span>
            </Tabs.Trigger>
          </Tabs.List>

          {users?.map((user) => (
            <Tabs.Content key={user.id} value={user.id}>
              <UserTabContent
                account={user}
                canDelete={!user.isSuper}
                canDeleteOwn={!user.isSuper}
                onDelete={() => setDeleteDialogOpen(true)}
                user={user}
              />
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </div>

      <CreateUserDialog
        onOpenChange={setCreateDialogOpen}
        onSuccess={async (newUserId) => {
          await mutate({ endpoint: 'users', method: 'get' })
          if (newUserId) {
            setSelectedUserId(newUserId)
          }
        }}
        open={createDialogOpen}
      />

      <DeleteUserDialog
        onOpenChange={setDeleteDialogOpen}
        onSuccess={async () => {
          await mutate({ endpoint: 'users', method: 'get' })
          // Switch to current user's tab after deletion
          setSelectedUserId(currentUser.id)
        }}
        open={deleteDialogOpen}
        userId={selectedUserId}
      />
    </div>
  )
}
