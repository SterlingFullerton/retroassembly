import { inArray } from 'drizzle-orm'
import { romTable } from '#@/databases/schema.ts'
import { type LibraryScope, romsOf } from '#@/utils/server/library-scope.ts'

/** Which games are stored in the given files: for games kept on a device before their names were kept with them */
export async function findRomsByFiles(scope: LibraryScope, fileIds: string[]) {
  if (fileIds.length === 0) {
    return []
  }
  return await scope.db
    .selectDistinct({ fileId: romTable.fileId, fileName: romTable.fileName, platform: romTable.platform })
    .from(romTable)
    .where(romsOf(scope, inArray(romTable.fileId, fileIds)))
}
