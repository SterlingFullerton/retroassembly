import { Outlet, type ShouldRevalidateFunctionArgs } from 'react-router'
import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import LibraryLayout from '../library/components/library-layout/library-layout.tsx'
import type { Route } from './+types/library-layout.ts'

// What every library page shares: the games played most recently, for the home page and search, and whether the user
// is the admin, who alone sees every account in the settings. Someone not signed in is sent to log in, and back to the
// page they wanted after
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return readPageData(request, pagesClient.library.$get({}, getPageRequestOptions(request)))
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
