import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'

/**
 * What the signed-in user may do in the server's library, by their role: everyone plays; contributors and admins add
 * games and edit them; only admins delete them. The server decides; this is what the pages offer
 */
export function usePermissions() {
  const { currentUser } = useGlobalLoaderData()
  const role = currentUser && 'role' in currentUser ? currentUser.role : 'player'
  return {
    canAddGames: role === 'admin' || role === 'contributor',
    canDeleteGames: role === 'admin',
    role,
  }
}
