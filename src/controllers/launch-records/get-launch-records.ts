import { and, count, countDistinct, desc, eq, inArray, max } from 'drizzle-orm'
import { favoriteTable, launchRecordTable, romTable, statusEnum } from '#@/databases/schema.ts'
import { discCount, type LibraryScope } from '#@/utils/server/library-scope.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'
import { findSearchMatches } from '../roms/search-roms.ts'

export async function getLaunchRecords(
  scope: LibraryScope,
  { page = 1, pageSize = 100, search }: { page?: number; pageSize?: number; search?: string },
) {
  const { user: currentUser, preference } = scope
  const library = scope.db

  const offset = (page - 1) * pageSize

  // With a search, only the played games that match it, still most recently played first
  const found = search ? await findSearchMatches(scope, { query: search }) : undefined
  const matchIds = found?.matches.map(({ id }) => id)
  if (matchIds?.length === 0) {
    return { pagination: { current: page, pages: 0, size: pageSize, total: 0 }, roms: [] }
  }

  const where = and(
    eq(launchRecordTable.userId, currentUser.id),
    eq(launchRecordTable.status, statusEnum.normal),
    inArray(launchRecordTable.platform, preference.ui.platforms),
    matchIds ? inArray(launchRecordTable.romId, matchIds) : undefined,
  )

  const romsRaw = await library
    .select({
      core: launchRecordTable.core,
      count: count(launchRecordTable.id),
      id: launchRecordTable.romId,
      isFavorite: favoriteTable.id,
      lastLaunched: max(launchRecordTable.createdAt),
      platform: launchRecordTable.platform,

      discCount: discCount(),
      fileId: romTable.fileId,
      fileName: romTable.fileName,
      gameBoxartFileIds: romTable.gameBoxartFileIds,
      gameName: romTable.gameName,
      gameTitle: romTable.gameTitle,
      launchboxGameId: romTable.launchboxGameId,
      libretroGameId: romTable.libretroGameId,
      rawGameMetadata: romTable.rawGameMetadata,
    })
    .from(launchRecordTable)
    .where(where)
    .leftJoin(romTable, eq(launchRecordTable.romId, romTable.id))
    .leftJoin(
      favoriteTable,
      and(
        eq(favoriteTable.romId, romTable.id),
        eq(favoriteTable.userId, currentUser.id),
        eq(favoriteTable.status, statusEnum.normal),
      ),
    )
    .groupBy(launchRecordTable.romId, romTable.fileName, romTable.launchboxGameId, romTable.libretroGameId)
    .orderBy(desc(max(launchRecordTable.createdAt)))
    .offset(offset)
    .limit(pageSize)

  const roms = romsRaw.map(({ isFavorite, ...rom }) => Object.assign(rom, { isFavorite: Boolean(isFavorite) }))

  const [{ total }] = await library
    .select({ total: countDistinct(launchRecordTable.romId) })
    .from(launchRecordTable)
    .where(where)
  const pagination = { current: page, pages: Math.ceil(total / pageSize), size: pageSize, total }
  await addCoverCandidates(roms)
  return {
    pagination,
    roms,
  }
}
