import { useSyncExternalStore } from 'react'
import {
  getSharing,
  joinCodeSwitch,
  playTogetherSwitch,
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

/** The experiment's switch, which is this device's own: whether it's on, and a way to set it */
export function usePlayTogetherSwitch() {
  const enabled = useSyncExternalStore(playTogetherSwitch.subscribe, playTogetherSwitch.isEnabled, isEnabledOnServer)
  return [enabled, playTogetherSwitch.setEnabled] as const
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
