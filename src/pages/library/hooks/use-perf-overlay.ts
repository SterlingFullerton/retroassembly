import { useSyncExternalStore } from 'react'
import { isPerfOverlayEnabled, setPerfOverlayEnabled, subscribePerfOverlay } from '#@/emulator/perf-monitor.ts'

function isEnabledOnServer() {
  return false
}

/** The performance overlay's switch, which is this device's own: whether it's on, and a way to set it */
export function usePerfOverlay() {
  const enabled = useSyncExternalStore(subscribePerfOverlay, isPerfOverlayEnabled, isEnabledOnServer)
  return [enabled, setPerfOverlayEnabled] as const
}
