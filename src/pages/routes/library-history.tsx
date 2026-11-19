import { getPageQuery, getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import HistoryPage from '../library/history/page.tsx'
import type { Route } from './+types/library-history.ts'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = pagesClient.library.history.$get({ query: getPageQuery(request) }, getPageRequestOptions(request))
  return readPageData(request, response)
}

export default function LibraryHistoryRoute() {
  return <HistoryPage />
}
