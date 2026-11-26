import useSWR from 'swr'
import { listOpenGames } from '#@/emulator/play-together-signal.ts'
import { useEmulatorLaunched } from '../atoms.ts'

// How often to ask whether anyone is sharing a game. Often enough that a guest sees the way in soon after the host
// invites; the answer is a few bytes
const askEvery = 5000

/**
 * The games being shared that anyone signed in may join, kept up to date while the library is open. Not while a game
 * runs on this device: there's no navigation to show it in then
 */
export function useOpenGames() {
  const [launched] = useEmulatorLaunched()
  const { data } = useSWR({ endpoint: 'play_together/invitations' }, listOpenGames, {
    keepPreviousData: true,
    refreshInterval: launched ? 0 : askEvery,
    // A server that can't be asked just now is asked again shortly; nothing is shown meanwhile
    shouldRetryOnError: false,
  })
  return data ?? []
}
