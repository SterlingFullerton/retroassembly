import { useSyncExternalStore } from 'react'
import {
  getSharing,
  getSharingConnection,
  joinCodeSwitch,
  type Sharing,
  subscribeSharing,
} from '#@/emulator/play-together-session.ts'

const notSharing: Sharing = { stage: 'idle' }

function isEnabledOnServer() {
  return false
}

function getSharingOnServer() {
  return notSharing
}

/** Whether a guest must be told a code to join a game shared from this device, and a way to set it */
export function useJoinCodeSwitch() {
  const enabled = useSyncExternalStore(joinCodeSwitch.subscribe, joinCodeSwitch.isEnabled, isEnabledOnServer)
  return [enabled, joinCodeSwitch.setEnabled] as const
}

/** What this device is sharing, if anything */
export function useSharing() {
  return useSyncExternalStore(subscribeSharing, getSharing, getSharingOnServer)
}

/** The connection to the guest of a game this device is sharing, once they've joined */
export function useSharingConnection() {
  const sharing = useSharing()
  return sharing.stage === 'connected' ? getSharingConnection() : undefined
}
