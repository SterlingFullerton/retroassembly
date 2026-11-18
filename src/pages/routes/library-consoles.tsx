import { getContext } from 'hono/context-storage'
import { getLibraryOverview } from '#@/controllers/roms/get-home-picks.ts'
import { getLibraryScope } from '#@/utils/server/library-scope.ts'
import ConsolesPage from '../library/consoles/page.tsx'

export async function loader() {
  const { consoles } = await getLibraryOverview(getLibraryScope())
  return { consoles, title: getContext().var.t('nav.consoles') }
}

export default function LibraryConsolesRoute() {
  return <ConsolesPage />
}
