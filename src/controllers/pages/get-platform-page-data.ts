import { eq } from 'drizzle-orm'
import { romTable } from '#@/databases/schema.ts'
import { getLibraryScope, romsOf } from '#@/utils/server/library-scope.ts'
import { loadPlatformPage } from '#@/utils/server/list-page.ts'

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

export async function getPlatformPageData(platform: string) {
  if (platform === 'sfc' && !(await hasSuperFamicomGames())) {
    return { redirect: { platform: 'snes' } }
  }
  return loadPlatformPage(platform)
}
