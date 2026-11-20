import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import { LibraryHomePage } from '../library/home/page.tsx'
import type { Route } from './+types/library-home.ts'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return readPageData(request, pagesClient.library.home.$get({}, getPageRequestOptions(request)))
}

export default function LibraryRoute() {
  return <LibraryHomePage />
}
