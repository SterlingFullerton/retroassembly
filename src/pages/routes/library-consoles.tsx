import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import ConsolesPage from '../library/consoles/page.tsx'
import type { Route } from './+types/library-consoles.ts'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return readPageData(request, pagesClient.library.consoles.$get({}, getPageRequestOptions(request)))
}

export default function LibraryConsolesRoute() {
  return <ConsolesPage />
}
