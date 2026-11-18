import { and, count, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm'
import { favoriteTable, launchRecordTable, romTable, statusEnum } from '#@/databases/schema.ts'
import { discCount, type LibraryScope, listedOnce } from '#@/utils/server/library-scope.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'

// What Home shows besides the game to continue: its consoles, and rows of games picked from it.
// Ratings are LaunchBox's community ratings (out of 5) and how many people gave one; games with few ratings are left
// out of the picks, so they're games worth trying rather than demos and hacks

const rating = sql<number>`coalesce(json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRating'), 0)`
const ratingCount = sql<number>`coalesce(json_extract(${romTable.rawGameMetadata}, '$.launchbox.communityRatingCount'), 0)`

/** The games listed in the library: the owner's, on the consoles shown, each game on several discs once */
function listed(scope: LibraryScope) {
  return and(
    eq(romTable.userId, scope.libraryOwnerId),
    eq(romTable.status, statusEnum.normal),
    inArray(romTable.platform, scope.preference.ui.platforms),
    listedOnce(),
  )
}

/** Games this player has started at least once */
function played(scope: LibraryScope) {
  return scope.db
    .select({ id: launchRecordTable.romId })
    .from(launchRecordTable)
    .where(and(eq(launchRecordTable.userId, scope.user.id), eq(launchRecordTable.status, statusEnum.normal)))
}

/** Whole rows for these games, in this order, as the game lists have them */
async function romsByIds(scope: LibraryScope, ids: string[]) {
  if (ids.length === 0) {
    return []
  }
  const rows = await scope.db
    .select({
      discCount: discCount(),
      isFavorite: sql<number>`CASE WHEN ${favoriteTable.id} IS NOT NULL THEN 1 ELSE 0 END`,
      rom: romTable,
    })
    .from(romTable)
    .leftJoin(
      favoriteTable,
      and(
        eq(favoriteTable.romId, romTable.id),
        eq(favoriteTable.userId, scope.user.id),
        eq(favoriteTable.status, statusEnum.normal),
      ),
    )
    .where(inArray(romTable.id, ids))
  const byId = new Map(
    rows.map(({ discCount, isFavorite, rom }) => [
      rom.id,
      Object.assign(rom, { discCount, isFavorite: Boolean(isFavorite) }),
    ]),
  )
  const roms = ids.map((id) => byId.get(id)).filter((rom) => rom !== undefined)
  await addCoverCandidates(roms)
  return roms
}

/** How many games each console has, most first */
export async function getLibraryOverview(scope: LibraryScope) {
  const consoles = await scope.db
    .select({ count: count(), platform: romTable.platform })
    .from(romTable)
    .where(listed(scope))
    .groupBy(romTable.platform)
    .orderBy(desc(count()))

  return { consoles }
}

/** Well-rated games this player has never started, a different handful each time */
export async function getRediscoverPicks(scope: LibraryScope, limit = 12) {
  const rows = await scope.db
    .select({ id: romTable.id })
    .from(romTable)
    .where(and(listed(scope), notInArray(romTable.id, played(scope)), gte(rating, 3.5), gte(ratingCount, 10)))
    .orderBy(sql`random()`)
    .limit(limit)
  return await romsByIds(
    scope,
    rows.map(({ id }) => id),
  )
}

/** Games first released on this day of the year (as MM-DD), the best known first */
export async function getOnThisDayPicks(scope: LibraryScope, monthDay: string, limit = 12) {
  const rows = await scope.db
    .select({ id: romTable.id })
    .from(romTable)
    .where(
      and(
        listed(scope),
        isNotNull(romTable.gameReleaseDate),
        sql`strftime('%m-%d', ${romTable.gameReleaseDate} / 1000, 'unixepoch') = ${monthDay}`,
      ),
    )
    .orderBy(desc(ratingCount))
    .limit(limit)
  return await romsByIds(
    scope,
    rows.map(({ id }) => id),
  )
}

/** Well-known games for two or more players, a different handful each time */
export async function getPlayTogetherPicks(scope: LibraryScope, limit = 12) {
  const rows = await scope.db
    .select({ id: romTable.id })
    .from(romTable)
    .where(and(listed(scope), gte(romTable.gamePlayers, 2), gte(rating, 3), gte(ratingCount, 20)))
    .orderBy(sql`random()`)
    .limit(limit)
  return await romsByIds(
    scope,
    rows.map(({ id }) => id),
  )
}
