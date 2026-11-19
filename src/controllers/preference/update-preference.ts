import { eq, type InferInsertModel } from 'drizzle-orm'
import { platforms } from '#@/constants/platform.ts'
import { type PreferenceSnippet, resolveUserPreference } from '#@/constants/preference.ts'
import { userPreferenceTable } from '#@/databases/schema.ts'
import { mergePreference } from '#@/utils/isomorphic/preference.ts'
import type { LibraryScope } from '#@/utils/server/library-scope.ts'
import { withLibraryPlatforms } from './library-platforms.ts'

function normalize(preference: any) {
  // sort platforms and remove invalid platforms
  if (preference.ui?.platforms) {
    preference.ui.platforms = platforms.map(({ name }) => name).filter((name) => preference.ui.platforms.includes(name))
  }
  if (preference.ui?.platforms === null) {
    preference.ui.platforms = undefined
  }
}

export async function updatePreference(scope: LibraryScope, preference: PreferenceSnippet) {
  const { user: currentUser } = scope

  const where = eq(userPreferenceTable.userId, currentUser.id)
  const returning = {
    emulator: userPreferenceTable.emulator,
    input: userPreferenceTable.input,
    ui: userPreferenceTable.ui,
  }

  const results = await scope.db.select().from(userPreferenceTable).where(where)

  let newPreferenceResults: Pick<InferInsertModel<typeof userPreferenceTable>, keyof typeof returning>[]
  if (results.length > 0) {
    const [{ emulator, input, ui }] = results
    const newPreference: any = {}
    if (preference.emulator) {
      newPreference.emulator = mergePreference(emulator || {}, preference.emulator)
    }
    if (preference.input) {
      newPreference.input = mergePreference(input || {}, preference.input)
    }
    if (preference.ui) {
      newPreference.ui = mergePreference(ui || {}, preference.ui)
    }
    normalize(newPreference)

    newPreferenceResults = await scope.db
      .update(userPreferenceTable)
      .set({ ...newPreference, userId: currentUser.id })
      .where(where)
      .returning(returning)
  } else {
    const newPreference = { ...preference }

    normalize(newPreference)

    newPreferenceResults = await scope.db
      .insert(userPreferenceTable)
      .values({ ...preference, userId: currentUser.id })
      .returning(returning)
  }

  const [saved] = newPreferenceResults
  return await withLibraryPlatforms(resolveUserPreference(saved), {
    chosen: Boolean(saved?.ui?.platforms),
    db: scope.db,
    libraryOwnerId: scope.libraryOwnerId,
  })
}
