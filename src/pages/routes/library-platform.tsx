import { eq } from 'drizzle-orm'
import { redirect } from 'react-router'
import { romTable } from '#@/databases/schema.ts'
import { getLibraryScope, romsOf } from '#@/utils/server/library-scope.ts'
import { loadPlatformPage } from '#@/utils/server/list-page.ts'
import PlatformPage from '../library/platform/page.tsx'
import type { Route } from './+types/library-platform.ts'

// The library's SNES games were once filed as Super Famicom; with none left there, its page leads to SNES's
async function hasSuperFamicomGames() {
  const scope = getLibraryScope()
  const [game] = await scope.db
    .select({ id: romTable.id })
    .from(romTable)
    .where(romsOf(scope, eq(romTable.platform, 'sfc')))
    .limit(1)
  return Boolean(game)
}

export async function loader({ params, request }: Route.LoaderArgs) {
  if (params.platform === 'sfc' && !(await hasSuperFamicomGames())) {
    throw redirect(`/library/platform/snes${new URL(request.url).search}`)
  }
  return loadPlatformPage(params.platform)
}

export default function LibraryPlatformRoute() {
  return <PlatformPage />
}
