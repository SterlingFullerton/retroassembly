import { useLoaderData } from 'react-router'
import type { clientLoader as FavoritesLoader } from '#@/pages/routes/library-favorites.tsx'
import type { clientLoader as HistoryLoader } from '#@/pages/routes/library-history.tsx'
import type { clientLoader as PlatformLoader } from '#@/pages/routes/library-platform.tsx'
import type { clientLoader as LibraryLoader } from '#@/pages/routes/library-roms.tsx'

type Loader = typeof FavoritesLoader | typeof HistoryLoader | typeof LibraryLoader | typeof PlatformLoader

export function useRoms() {
  const { roms } = useLoaderData<Loader>()

  return { roms }
}
