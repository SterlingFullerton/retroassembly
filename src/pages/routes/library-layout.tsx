import { getContext } from 'hono/context-storage'
import { Outlet, redirect, type ShouldRevalidateFunctionArgs } from 'react-router'
import { defaultRedirectTo } from '#@/constants/auth.ts'
import { getLaunchRecords } from '#@/controllers/launch-records/get-launch-records.ts'
import { getAdmin, getLibraryScope } from '#@/utils/server/library-scope.ts'
import LibraryLayout from '../library/components/library-layout/library-layout.tsx'
import type { Route } from './+types/library-layout.ts'

// Every library page needs a signed-in user. Checked before any page loads its data; a signed-out visitor is sent to
// log in, and back to the page they wanted after
export const middleware: Route.MiddlewareFunction[] = [
  ({ request }) => {
    if (getContext().var.currentUser) {
      return
    }
    const { pathname, search } = new URL(request.url)
    const redirectTo = `${pathname}${search}`
    const loginUrl = new URL('/login', 'http://localhost')
    if (redirectTo !== defaultRedirectTo) {
      loginUrl.searchParams.set('redirect_to', redirectTo)
    }
    throw redirect(`${loginUrl.pathname}${loginUrl.search}`)
  },
]

// What every library page shares: the games played most recently, for the home page and search, and whether the user
// is the admin, who alone sees every account in the settings
export async function loader() {
  const scope = getLibraryScope()
  const [{ roms: recentlyLaunchedRoms }, admin] = await Promise.all([
    getLaunchRecords(scope, { pageSize: 20 }),
    getAdmin(scope),
  ])
  return { isAdmin: admin?.id === scope.user.id, recentlyLaunchedRoms }
}

// Loaded again only when something may have changed it, not on every move between library pages: after a change made
// on the page, an explicit refresh, or leaving a game's page, where a game may have been played
export function shouldRevalidate({
  currentUrl,
  defaultShouldRevalidate,
  formMethod,
  nextUrl,
}: ShouldRevalidateFunctionArgs) {
  const leavingGame = currentUrl.pathname.includes('/rom/') && currentUrl.pathname !== nextUrl.pathname
  if (formMethod || leavingGame || currentUrl.href === nextUrl.href) {
    return defaultShouldRevalidate
  }
  return false
}

export default function LibraryLayoutRoute() {
  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  )
}
