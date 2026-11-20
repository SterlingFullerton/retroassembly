import { attemptAsync } from 'es-toolkit'
import { useEffect, useEffectEvent } from 'react'
import { useEmulatorLaunched, useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'

// How often the game's own save is read while playing. Reading it is quick, and it's only uploaded when it changed
const intervalMs = 30_000

/**
 * Keeps the game's own save (memory card, battery save) while playing: it's read every 30 seconds, when the pause menu
 * opens and when the page is hidden, and uploaded when it changed. Exiting reads it too, in the session
 */
export function useKeepGameSave() {
  const { emulator, keepGameSave } = useSession()
  const [launched] = useEmulatorLaunched()
  const [overlayVisible] = useShowGameOverlayContent()

  // keepGameSave never throws: a save that doesn't upload stays queued
  const keep = useEffectEvent(() => {
    queueMicrotask(() => attemptAsync(keepGameSave))
  })

  useEffect(() => {
    if (!launched || !emulator) {
      return
    }
    const interval = setInterval(() => {
      if (emulator.getStatus() === 'running') {
        keep()
      }
    }, intervalMs)
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        keep()
      }
    }
    // In the capture phase on window, like the save on hide, before the emulator stops for the hidden page
    globalThis.addEventListener('visibilitychange', handleVisibilityChange, { capture: true })
    return () => {
      clearInterval(interval)
      globalThis.removeEventListener('visibilitychange', handleVisibilityChange, { capture: true })
    }
  }, [launched, emulator])

  useEffect(() => {
    if (launched && overlayVisible) {
      keep()
    }
  }, [launched, overlayVisible])
}
