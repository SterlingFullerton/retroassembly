import { generatePath, redirect } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import { getPageRequestOptions, pagesClient, readPageData } from '#@/utils/client/page-data.ts'
import RomPage from '../library/platform/rom/page.tsx'
import type { Route } from './+types/library-platform-rom.ts'

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const response = pagesClient.library.rom.$get(
    { query: { file_name: params.fileName ?? '', platform: params.platform ?? '' } },
    getPageRequestOptions(request),
  )
  const data = await readPageData(request, response)
  if ('redirect' in data) {
    throw redirect(generatePath(routes.libraryPlatformRom, data.redirect))
  }
  return data
}

export default function LibraryPlatformRomRoute() {
  return <RomPage />
}
