import { getContext } from 'hono/context-storage'
import { getLibraryOverview } from '#@/controllers/roms/get-home-picks.ts'
import { getLibraryScope } from '#@/utils/server/library-scope.ts'

export async function getConsolesPageData() {
  const { consoles } = await getLibraryOverview(getLibraryScope())
  return { consoles, title: getContext().var.t('nav.consoles') }
}
