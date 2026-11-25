import { useRouteLoaderData } from 'react-router'
import useSWR from 'swr'
import { client, parseResponse } from '#@/api/client.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { UserTabContent } from './user-tab-content.tsx'

/** The user's own account: its password, where it's signed in, and deleting it */
export function AccountSettings() {
  const { currentUser } = useGlobalLoaderData()

  // The library's owner can't delete their account. Only an admin can be the owner, and only the admins' list says who is
  const isAdmin = Boolean(useRouteLoaderData('library')?.isAdmin)
  const { data: users } = useSWR(isAdmin ? { endpoint: 'users', method: 'get' } : null, () =>
    parseResponse(client.users.$get()),
  )
  const isOwner = users?.find(({ id }) => id === currentUser.id)?.isSuper
  const canDeleteOwn = isAdmin ? isOwner === false : true

  return <UserTabContent canDelete={false} canDeleteOwn={canDeleteOwn} user={currentUser} />
}
