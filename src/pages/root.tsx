import '#@/styles/index.ts'
import '#@/utils/client/global.ts'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import { setCDNCacheEnabled } from '#@/utils/isomorphic/cdn.ts'
import { i18n } from '#@/utils/isomorphic/i18n.ts'
import type { Route } from './+types/root.ts'
import { AppLayout } from './components/app-layout.tsx'
import { ErrorPage } from './components/error-page.tsx'
import { LibrarySkeleton } from './components/library-skeleton.tsx'
import { useReloadOnUpdate } from './hooks/use-reload-on-update.ts'

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = pagesClient.common.$get(
    { query: { path: new URL(request.url).pathname } },
    getPageRequestOptions(request),
  )
  const data = await readPageData(request, response)
  setCDNCacheEnabled(data.cdnCache)
  // Switched before the page is drawn, so it never shows in another language first
  await i18n.changeLanguage(data.language)
  return data
}

export function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppLayout>{children}</AppLayout>
}

export default function App() {
  useReloadOnUpdate()
  return <Outlet />
}

// Shown while the page's data loads the first time, and written into the HTML every page is sent
export function HydrateFallback() {
  return <LibrarySkeleton />
}

export function ErrorBoundary(props: Readonly<Route.ErrorBoundaryProps>) {
  return <ErrorPage {...props} />
}
