import { and, count, countDistinct, desc, eq, gte, inArray, max } from 'drizzle-orm'
import { favoriteTable, romTable, stateTable, statusEnum } from '#@/databases/schema.ts'
import { discCount, type LibraryScope, listedOnce } from '#@/utils/server/library-scope.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'

export async function getRomsWithStates(scope: LibraryScope, { page = 1, pageSize = 20 } = {}) {
  const { user: currentUser, libraryOwnerId: effectiveLibraryUserId, preference } = scope
  const library = scope.db

  const offset = (page - 1) * pageSize
  const stateJoinCondition = and(
    eq(stateTable.romId, romTable.id),
    eq(stateTable.userId, currentUser.id),
    eq(stateTable.status, statusEnum.normal),
  )

  const romsRaw = await library
    .select({
      createdAt: romTable.createdAt,
      discCount: discCount(),
      fileId: romTable.fileId,
      fileName: romTable.fileName,
      gameBoxartFileIds: romTable.gameBoxartFileIds,
      gameName: romTable.gameName,
      gameTitle: romTable.gameTitle,
      id: romTable.id,
      isFavorite: favoriteTable.id,
      /** When this player last saved a state in it */
      lastSaved: max(stateTable.createdAt),
      launchboxGameId: romTable.launchboxGameId,
      libretroGameId: romTable.libretroGameId,
      platform: romTable.platform,
      rawGameMetadata: romTable.rawGameMetadata,
    })
    .from(romTable)
    .leftJoin(stateTable, stateJoinCondition)
    .leftJoin(
      favoriteTable,
      and(
        eq(favoriteTable.romId, romTable.id),
        eq(favoriteTable.userId, currentUser.id),
        eq(favoriteTable.status, statusEnum.normal),
      ),
    )
    .where(
      and(
        eq(romTable.userId, effectiveLibraryUserId),
        eq(romTable.status, statusEnum.normal),
        inArray(romTable.platform, preference.ui.platforms),
        listedOnce(),
      ),
    )
    .groupBy(
      romTable.id,
      romTable.fileName,
      romTable.gameBoxartFileIds,
      romTable.gameName,
      romTable.gameTitle,
      romTable.launchboxGameId,
      romTable.libretroGameId,
      romTable.platform,
      favoriteTable.id,
    )
    .having(gte(count(stateTable.id), 1))
    .orderBy(desc(max(stateTable.createdAt)))
    .offset(offset)
    .limit(pageSize)

  const roms = romsRaw.map(({ isFavorite, ...rom }) => Object.assign(rom, { isFavorite: Boolean(isFavorite) }))

  const where = and(
    eq(romTable.userId, effectiveLibraryUserId),
    eq(romTable.status, statusEnum.normal),
    inArray(romTable.platform, preference.ui.platforms),
    listedOnce(),
  )
  const res = await library
    .select({ total: countDistinct(romTable.id) })
    .from(romTable)
    .leftJoin(stateTable, stateJoinCondition)
    .where(where)
    .groupBy(romTable.id)
    .having(gte(count(stateTable.id), 1))
  const total = res[0]?.total || 0
  const pagination = { current: page, pages: Math.ceil(total / pageSize), size: pageSize, total }
  await addCoverCandidates(roms)
  return { pagination, roms }
}
