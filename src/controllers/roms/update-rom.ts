import { and, eq } from 'drizzle-orm'
import { romTable } from '#@/databases/schema.ts'
import { assertCanWriteLibrary, findRom, type LibraryScope } from '#@/utils/server/library-scope.ts'

export async function updateRom(
  scope: LibraryScope,
  rom: {
    gameBoxartFileIds?: null | string
    gameDescription?: null | string
    gameDeveloper?: null | string
    gameGenres?: null | string
    gameName?: null | string
    gameTitle?: null | string
    gamePlayers?: null | number
    gamePublisher?: null | string
    gameReleaseDate?: Date | null
    gameReleaseYear?: null | number
    gameThumbnailFileIds?: null | string
    id: string
  },
) {
  assertCanWriteLibrary(scope)
  await findRom(scope, rom.id)
  const [updatedRom] = await scope.db
    .update(romTable)
    .set(rom)
    .where(and(eq(romTable.id, rom.id), eq(romTable.userId, scope.user.id)))
    .returning()
  return updatedRom
}
