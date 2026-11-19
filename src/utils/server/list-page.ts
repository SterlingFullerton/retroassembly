import { getContext } from 'hono/context-storage'
import { HTTPException } from 'hono/http-exception'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { getLaunchRecords } from '#@/controllers/launch-records/get-launch-records.ts'
import { getRomLetters } from '#@/controllers/roms/get-rom-letters.ts'
import { getRomPlatformCount } from '#@/controllers/roms/get-rom-platform-count.ts'
import { getRoms } from '#@/controllers/roms/get-roms.ts'
import { getLibraryScope } from './library-scope.ts'
import { getRomsQuery } from './misc.ts'

// The pages listing games: Games, Favorites, History, and a console's games. The sort, order and page come from the
// address

/** Where each letter starts, for a list sorted by name on more than one page; nothing otherwise */
async function lettersFor(
  query: ReturnType<typeof getRomsQuery>,
  pages: number,
  options: Parameters<typeof getRomLetters>[1] = {},
) {
  if (query.orderBy !== 'name' || pages <= 1) {
    return
  }
  return await getRomLetters(getLibraryScope(), { direction: query.direction, ...options })
}

export async function loadGamesPage() {
  const scope = getLibraryScope()
  const query = getRomsQuery()
  const [{ matchIds, pagination, roms, search }, platformCount] = await Promise.all([
    getRoms(scope, query),
    getRomPlatformCount(scope),
  ])
  const letters = await lettersFor(query, pagination.pages, { favorite: query.favorite, ids: matchIds })
  return { letters, pagination, platformCount, roms, search, title: getContext().var.t('common.games') }
}

export async function loadFavoritesPage() {
  const query = getRomsQuery()
  const { matchIds, pagination, roms, search } = await getRoms(getLibraryScope(), { ...query, favorite: true })
  const letters = await lettersFor(query, pagination.pages, { favorite: true, ids: matchIds })
  return { letters, pagination, roms, search, title: getContext().var.t('nav.favorites') }
}

export async function loadHistoryPage() {
  const { page, search } = getRomsQuery()
  const { pagination, roms } = await getLaunchRecords(getLibraryScope(), { page, search })
  return {
    page,
    pagination,
    roms,
    search: search ? { query: search } : undefined,
    title: getContext().var.t('nav.history'),
  }
}

/** A console's games; a console the app doesn't know is not found */
export async function loadPlatformPage(name: string | undefined) {
  if (!name || !(name in platformMap)) {
    throw new HTTPException(404, { message: 'Not Found' })
  }
  const platform = name as PlatformName
  const query = getRomsQuery()
  const { matchIds, pagination, roms, search } = await getRoms(getLibraryScope(), { ...query, platform })
  const letters = await lettersFor(query, pagination.pages, { favorite: query.favorite, ids: matchIds, platform })
  return {
    favorite: query.favorite,
    letters,
    pagination,
    platform,
    roms,
    search,
    title: getContext().var.t(platformMap[platform].displayNameI18nKey),
  }
}
