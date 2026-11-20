import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import Fuse from 'fuse.js'
import type { PlatformName } from '#@/constants/platform.ts'
import { favoriteTable, romTable, statusEnum } from '#@/databases/schema.ts'
import { getSearchTitle, scoreRom } from '#@/utils/isomorphic/search.ts'
import { discCount, type LibraryScope, listedOnce } from '#@/utils/server/library-scope.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'

type SearchRomsReturning = Awaited<ReturnType<typeof searchRoms>>
export type SearchRoms = SearchRomsReturning['roms']
export type SearchRom = SearchRoms[number]
export type SearchRomsPagination = SearchRomsReturning['pagination']

// Typo-tolerant matching, used only when no name has every word typed in it: "zelad" still finds Zelda
const fuseOptions = {
  ignoreLocation: true,
  includeScore: true,
  keys: ['title', 'gameName'],
  threshold: 0.35,
}

interface Candidate {
  gameDeveloper: null | string
  gameName: null | string
  gamePublisher: null | string
  fileName: string
  id: string
  isFavorite: boolean
  popularity: number
  score: number
  title: string
}

/** The candidates matching a search, best first. Exported for the Go server's tests (scripts/go-test-fixtures.ts) */
export function rank<T extends Candidate>(candidates: T[], query: string) {
  for (const candidate of candidates) {
    candidate.score = scoreRom(candidate, query)
  }
  let matches = candidates.filter(({ score }) => score > 0)
  // Short searches like "ff" would match nearly anything this way
  if (matches.length === 0 && query.replaceAll(' ', '').length > 3) {
    const fuse = new Fuse(candidates, fuseOptions)
    matches = fuse.search(query).map(({ item, score = 1 }) => Object.assign(item, { score: 20 * (1 - score) }))
  }
  // Best match first; among equals, favorites, then games more people have rated on LaunchBox (so the well-known
  // games come before hacks and demos with similar names), then the shortest name (the game itself before its
  // spin-offs), then alphabetical, which keeps a game's regional versions together
  return matches.toSorted(
    (a, b) =>
      b.score - a.score ||
      Number(b.isFavorite) - Number(a.isFavorite) ||
      b.popularity - a.popularity ||
      a.title.length - b.title.length ||
      a.fileName.localeCompare(b.fileName),
  )
}

function normalizeQuery(query: string) {
  return query.trim().replaceAll(/\s+/gu, ' ')
}

function favoriteJoinCondition(userId: string) {
  return and(
    eq(favoriteTable.romId, romTable.id),
    eq(favoriteTable.userId, userId),
    eq(favoriteTable.status, statusEnum.normal),
  )
}

const isFavorite = sql<boolean>`CASE WHEN ${favoriteTable.id} IS NOT NULL THEN 1 ELSE 0 END`

interface FindSearchMatchesParams {
  favorite?: boolean
  platform?: PlatformName
  query: string
}

/**
 * Every game in the list that matches a search, best match first, and how many games were searched. The quick search
 * and a game list's search box both use it, so they find the same games in the same order
 */
export async function findSearchMatches(
  scope: LibraryScope,
  { favorite = false, platform, query }: FindSearchMatchesParams,
) {
  const { user: currentUser, libraryOwnerId: effectiveLibraryUserId, preference } = scope

  const conditions = [
    eq(romTable.userId, effectiveLibraryUserId),
    eq(romTable.status, statusEnum.normal),
    platform ? eq(romTable.platform, platform) : inArray(romTable.platform, preference.ui.platforms),
    listedOnce(),
  ]
  if (favorite) {
    conditions.push(isNotNull(favoriteTable.id))
  }

  // Only what ranking needs is read for every game
  const rows = await scope.db
    .select({
      fileName: romTable.fileName,
      gameDeveloper: romTable.gameDeveloper,
      gameName: romTable.gameName,
      gamePublisher: romTable.gamePublisher,
      gameTitle: romTable.gameTitle,
      id: romTable.id,
      isFavorite,
      platform: romTable.platform,
      popularity: sql<number>`coalesce(json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRatingCount'), 0)`,
    })
    .from(romTable)
    .leftJoin(favoriteTable, favoriteJoinCondition(currentUser.id))
    .where(and(...conditions))
  // Arcade files are named like "sf2.zip"; the library shows their game's name
  const candidates = rows.map((row) =>
    Object.assign(row, {
      score: 0,
      title: row.gameTitle || (row.platform === 'arcade' && row.gameName ? row.gameName : getSearchTitle(row.fileName)),
    }),
  )
  return { matches: rank(candidates, normalizeQuery(query)), searched: candidates.length }
}

export async function searchRoms(
  scope: LibraryScope,
  {
    page = 1,
    pageSize = 100,
    platform,
    query,
  }: {
    page?: number
    pageSize?: number
    platform?: PlatformName
    query: string
  } = {} as any,
) {
  const trimmedQuery = normalizeQuery(query)
  const { matches: ranked } = await findSearchMatches(scope, { platform, query })

  // Whole rows only for the page returned
  const offset = (page - 1) * pageSize
  const pageIds = ranked.slice(offset, offset + pageSize).map(({ id }) => id)
  const pageRows = pageIds.length
    ? await scope.db
        .select({ discCount: discCount(), isFavorite, rom: romTable })
        .from(romTable)
        .leftJoin(favoriteTable, favoriteJoinCondition(scope.user.id))
        .where(inArray(romTable.id, pageIds))
    : []
  const byId = new Map(
    pageRows.map(({ discCount, isFavorite, rom }) => [rom.id, Object.assign(rom, { discCount, isFavorite })]),
  )
  const roms = pageIds.map((id) => byId.get(id)).filter((rom) => rom !== undefined)

  const total = ranked.length
  await addCoverCandidates(roms)

  return {
    pagination: {
      current: page,
      pages: Math.ceil(total / pageSize),
      size: pageSize,
      total,
    },
    platform,
    query,
    roms,
    trimmedQuery,
  }
}
