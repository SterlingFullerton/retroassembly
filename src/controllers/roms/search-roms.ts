import { and, eq, inArray, sql } from 'drizzle-orm'
import Fuse from 'fuse.js'
import { getContext } from 'hono/context-storage'
import type { PlatformName } from '#@/constants/platform.ts'
import { favoriteTable, romTable, statusEnum } from '#@/databases/schema.ts'
import { getSearchTitle, scoreRom } from '#@/utils/isomorphic/search.ts'
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

function rank(candidates: Candidate[], query: string) {
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

export async function searchRoms(
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
  const { currentUser, db, effectiveLibraryUserId, preference } = getContext().var
  const { library } = db

  const conditions = [
    eq(romTable.userId, effectiveLibraryUserId),
    eq(romTable.status, statusEnum.normal),
    platform ? eq(romTable.platform, platform) : inArray(romTable.platform, preference.ui.platforms),
  ]
  const trimmedQuery = query.trim().replaceAll(/\s+/gu, ' ')
  const where = and(...conditions)

  const favoriteJoinCondition = and(
    eq(favoriteTable.romId, romTable.id),
    eq(favoriteTable.userId, currentUser.id),
    eq(favoriteTable.status, statusEnum.normal),
  )
  const isFavorite = sql<boolean>`CASE WHEN ${favoriteTable.id} IS NOT NULL THEN 1 ELSE 0 END`

  // Only what ranking needs is read for every game; whole rows only for the page returned
  const rows = await library
    .select({
      fileName: romTable.fileName,
      gameDeveloper: romTable.gameDeveloper,
      gameName: romTable.gameName,
      gamePublisher: romTable.gamePublisher,
      id: romTable.id,
      isFavorite,
      platform: romTable.platform,
      popularity: sql<number>`coalesce(json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRatingCount'), 0)`,
    })
    .from(romTable)
    .leftJoin(favoriteTable, favoriteJoinCondition)
    .where(where)
  // Arcade files are named like "sf2.zip"; the library shows their game's name
  const candidates = rows.map((row) =>
    Object.assign(row, {
      score: 0,
      title: row.platform === 'arcade' && row.gameName ? row.gameName : getSearchTitle(row.fileName),
    }),
  )
  const ranked = rank(candidates, trimmedQuery)

  const offset = (page - 1) * pageSize
  const pageIds = ranked.slice(offset, offset + pageSize).map(({ id }) => id)
  const pageRows = pageIds.length
    ? await library
        .select({ isFavorite, rom: romTable })
        .from(romTable)
        .leftJoin(favoriteTable, favoriteJoinCondition)
        .where(inArray(romTable.id, pageIds))
    : []
  const byId = new Map(pageRows.map(({ isFavorite, rom }) => [rom.id, Object.assign(rom, { isFavorite })]))
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
