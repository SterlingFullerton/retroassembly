import { and, eq } from 'drizzle-orm'
import { type PlatformName, platforms } from '#@/constants/platform.ts'
import type { resolveUserPreference } from '#@/constants/preference.ts'
import { romTable, statusEnum } from '#@/databases/schema.ts'

type Preference = ReturnType<typeof resolveUserPreference>

// Asked on every request, so kept for a short while; a console that gets its first games shows up within a minute
const cache = new Map<string, { at: number; platforms: PlatformName[] }>()
const maxAge = 60_000

/** The consoles that have games in a library, in the app's usual order */
async function getLibraryPlatforms(db, libraryOwnerId: string) {
  const cached = cache.get(libraryOwnerId)
  if (cached && Date.now() - cached.at < maxAge) {
    return cached.platforms
  }
  const rows: { platform: PlatformName }[] = await db
    .selectDistinct({ platform: romTable.platform })
    .from(romTable)
    .where(and(eq(romTable.userId, libraryOwnerId), eq(romTable.status, statusEnum.normal)))
  const found = new Set(rows.map(({ platform }) => platform))
  const result = platforms.map(({ name }) => name).filter((name) => found.has(name))
  cache.set(libraryOwnerId, { at: Date.now(), platforms: result })
  return result
}

/**
 * A player who hasn't chosen their consoles sees every console with games in the library they use (the admin's, for a
 * shared player), so new consoles show up as games arrive. A list they chose is kept as it is. A library with no games
 * yet keeps the usual starting set
 */
export async function withLibraryPlatforms(
  preference: Preference,
  { chosen, db, libraryOwnerId }: Readonly<{ chosen: boolean; db; libraryOwnerId: string }>,
) {
  if (chosen) {
    return preference
  }
  const libraryPlatforms = await getLibraryPlatforms(db, libraryOwnerId)
  if (libraryPlatforms.length > 0) {
    preference.ui.platforms = libraryPlatforms
  }
  return preference
}
