import { getPageQuery, getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import FavoritesPage from '../library/favorites/page.tsx'
import type { Route } from './+types/library-favorites.ts'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = pagesClient.library.favorites.$get({ query: getPageQuery(request) }, getPageRequestOptions(request))
  return readPageData(request, response)
}

export default function LibraryFavoritesRoute() {
  return <FavoritesPage />
}
