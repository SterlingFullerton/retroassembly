import { getPageQuery, getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import LibraryROMsPage from '../library/roms/page.tsx'
import type { Route } from './+types/library-roms.ts'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = pagesClient.library.roms.$get({ query: getPageQuery(request) }, getPageRequestOptions(request))
  return readPageData(request, response)
}

export default function LibraryRoute() {
  return <LibraryROMsPage />
}
