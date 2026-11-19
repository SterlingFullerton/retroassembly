import { generatePath, redirect } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import { getPageQuery, getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import PlatformPage from '../library/platform/page.tsx'
import type { Route } from './+types/library-platform.ts'

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const response = pagesClient.library.platform.$get(
    { query: { ...getPageQuery(request), platform: params.platform ?? '' } },
    getPageRequestOptions(request),
  )
  const data = await readPageData(request, response)
  if ('redirect' in data) {
    throw redirect(`${generatePath(routes.libraryPlatform, data.redirect)}${new URL(request.url).search}`)
  }
  return data
}

export default function LibraryPlatformRoute() {
  return <PlatformPage />
}
