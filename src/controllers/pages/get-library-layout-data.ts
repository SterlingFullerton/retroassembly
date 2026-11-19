import { getLaunchRecords } from '#@/controllers/launch-records/get-launch-records.ts'
import { getAdmin, getLibraryScope } from '#@/utils/server/library-scope.ts'

// What every library page shares: the games played most recently, for the home page and search, and whether the user
// is the admin, who alone sees every account in the settings
export async function getLibraryLayoutData() {
  const scope = getLibraryScope()
  const [{ roms: recentlyLaunchedRoms }, admin] = await Promise.all([
    getLaunchRecords(scope, { pageSize: 20 }),
    getAdmin(scope),
  ])
  return { isAdmin: admin?.id === scope.user.id, recentlyLaunchedRoms }
}
