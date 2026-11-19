import { and, eq } from 'drizzle-orm'
import { getContext } from 'hono/context-storage'
import { platformMap } from '#@/constants/platform.ts'
import { resolveUserPreference } from '#@/constants/preference.ts'
import { statusEnum, userPreferenceTable } from '#@/databases/schema.ts'
import { withLibraryPlatforms } from './library-platforms.ts'

export async function getPreference() {
  const { currentUser, db, effectiveLibraryUserId } = getContext().var

  const results = await db.library
    .select({ emulator: userPreferenceTable.emulator, input: userPreferenceTable.input, ui: userPreferenceTable.ui })
    .from(userPreferenceTable)
    .where(and(eq(userPreferenceTable.userId, currentUser.id), eq(userPreferenceTable.status, statusEnum.normal)))

  const [userPreference] = results
  if (userPreference?.ui?.platforms) {
    userPreference.ui.platforms = userPreference.ui.platforms.filter((platform) => platform in platformMap)
  }

  return await withLibraryPlatforms(resolveUserPreference(userPreference), {
    chosen: Boolean(userPreference?.ui?.platforms),
    db: db.library,
    libraryOwnerId: effectiveLibraryUserId || currentUser.id,
  })
}
