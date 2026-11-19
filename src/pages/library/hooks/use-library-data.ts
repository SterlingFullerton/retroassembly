import { useMatches, useRouteLoaderData } from 'react-router'
import type { clientLoader as loader } from '#@/pages/routes/library-layout.tsx'

/** What the library layout loads once for every library page: the games played most recently */
export function useLibraryData() {
  const data = useRouteLoaderData<typeof loader>('library')
  if (!data) {
    throw new Error('useLibraryData must be used within the library layout')
  }
  return data
}

/** The title of the page being shown, for the layout around it */
export function usePageTitle() {
  const matches = useMatches()
  const data = matches.at(-1)?.loaderData as undefined | { title?: string }
  return data?.title ?? ''
}
