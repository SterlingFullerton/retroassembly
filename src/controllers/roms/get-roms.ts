import { and, count, desc, eq, inArray, isNotNull, max, sql } from 'drizzle-orm'
import { getContext } from 'hono/context-storage'
import type { PlatformName } from '#@/constants/platform.ts'
import type { RomsOrder } from '#@/constants/roms-order.ts'
import { favoriteTable, launchRecordTable, romTable, statusEnum } from '#@/databases/schema.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'

type GetRomsReturning = Awaited<ReturnType<typeof getRoms>>
export type Roms = GetRomsReturning['roms']
export type Rom = Roms[number]
export type RomsPagination = GetRomsReturning['pagination']

// Popular: the game's LaunchBox rating, weighted by how many people rated it, so a 4.9 from 3 votes doesn't beat a 4.4
// from 600. It's the rating, pulled towards an average (3.5) as if by 100 more votes; games nobody rated sort last
const ratingCount = sql`json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRatingCount')`
const rating = sql`json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRating')`
const popularity = sql`CASE WHEN ${ratingCount} > 0 THEN (${ratingCount} * ${rating} + 350.0) / (${ratingCount} + 100) END`

interface GetRomsParams {
  direction?: 'asc' | 'desc'
  favorite?: boolean
  id?: string
  orderBy?: RomsOrder
  page?: number
  pageSize?: number
  platform?: PlatformName
}

export async function getRoms({
  direction = 'asc',
  favorite = false,
  id,
  orderBy = 'name',
  page = 1,
  pageSize = 100,
  platform,
}: GetRomsParams = {}) {
  const { currentUser, db, effectiveLibraryUserId, preference } = getContext().var

  const { library } = db

  const conditions = [eq(romTable.userId, effectiveLibraryUserId), eq(romTable.status, statusEnum.normal)]
  if (id) {
    conditions.push(eq(romTable.id, id))
  }
  if (platform) {
    conditions.push(eq(romTable.platform, platform))
  } else {
    conditions.push(inArray(romTable.platform, preference.ui.platforms))
  }
  const where = and(...conditions)

  const offset = (page - 1) * pageSize
  // Most played: how many times this player has launched the game, then how recently
  const plays = library
    .select({
      count: count().as('play_count'),
      last: max(launchRecordTable.createdAt).as('last_played'),
      romId: launchRecordTable.romId,
    })
    .from(launchRecordTable)
    .where(and(eq(launchRecordTable.userId, currentUser.id), eq(launchRecordTable.status, statusEnum.normal)))
    .groupBy(launchRecordTable.romId)
    .as('plays')

  const columnMap = {
    added: sql`${romTable.createdAt}`,
    name: sql`LOWER(${romTable.fileName})`,
    played: sql`${plays.count}`,
    popular: popularity,
    released: sql`${romTable.gameReleaseDate}`,
  }
  const column = columnMap[orderBy]
  const columns = [sql`${column} IS NULL`, direction === 'desc' ? desc(column) : column]
  if (orderBy === 'played') {
    const lastPlayed = sql`${plays.last}`
    columns.push(direction === 'desc' ? desc(lastPlayed) : lastPlayed)
  }
  if (orderBy !== 'name') {
    columns.push(columnMap.name)
  }
  const favoriteJoinCondition = and(
    eq(favoriteTable.romId, romTable.id),
    eq(favoriteTable.userId, currentUser.id),
    eq(favoriteTable.status, statusEnum.normal),
  )

  const baseQuery = library
    .select({
      isFavorite: sql<boolean>`CASE WHEN ${favoriteTable.id} IS NOT NULL THEN 1 ELSE 0 END`,
      rom: romTable,
    })
    .from(romTable)
    .leftJoin(favoriteTable, favoriteJoinCondition)
    .leftJoin(plays, eq(plays.romId, romTable.id))

  const favoriteWhere = favorite ? and(where, isNotNull(favoriteTable.id)) : where

  const romsRaw = await baseQuery
    .orderBy(...columns)
    .where(favoriteWhere)
    .offset(offset)
    .limit(pageSize)

  const roms = romsRaw.map(({ isFavorite, rom }) => Object.assign(rom, { isFavorite }))

  const [{ total }] = await library
    .select({ total: count() })
    .from(romTable)
    .leftJoin(favoriteTable, favoriteJoinCondition)
    .where(favoriteWhere)

  await addCoverCandidates(roms)
  return { pagination: { current: page, pages: Math.ceil(total / pageSize), size: pageSize, total }, roms }
}
