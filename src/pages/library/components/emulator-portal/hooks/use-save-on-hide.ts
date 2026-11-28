import { attemptAsync } from 'es-toolkit'
import { useEffect, useRef } from 'react'
import { saveQueue } from '#@/emulator/save-queue.ts'
import { captureState } from '#@/emulator/saves.ts'
import { useEmulatorLaunched, useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useGameStates } from './use-game-states.ts'

interface SavedState {
  state: Blob
  thumbnail: Blob
}

// Mobile browsers often unload a page soon after you switch to another app, which loses the game. When the page is
// hidden, pause the game and save it, first in the browser and then to the server, and resume it if the page comes back.
export function useSaveOnHide() {
  const { core, currentDisc, emulator, launchProfile } = useSession()
  const rom = useRom()
  const [launched] = useEmulatorLaunched()
  const { reloadAutoStates } = useGameStates()
  // The pause menu, opened since: the game then stays paused behind it
  const [menuShown] = useShowGameOverlayContent()
  const menuShownRef = useRef(menuShown)
  useEffect(() => {
    menuShownRef.current = menuShown
  }, [menuShown])

  useEffect(() => {
    if (!launched || !emulator || !core || !rom) {
      return
    }

    let pausedOnHide = false
    let capturing: Promise<SavedState> | undefined

    // A save that fails to upload stays in the browser and is uploaded the next time the library opens
    async function persistQuietly(capturing: Promise<SavedState>) {
      if (!core || !rom) {
        return
      }
      try {
        await saveQueue.save({ core, disc: currentDisc, rom: rom.id, type: 'auto', ...(await capturing) })
        await reloadAutoStates()
      } catch {}
    }

    async function handleVisibilityChange() {
      if (!emulator) {
        return
      }
      if (document.visibilityState === 'hidden') {
        // Leave the game alone when it is already paused, for example with the menu open
        if (emulator.getStatus() !== 'running') {
          return
        }
        emulator.pause()
        pausedOnHide = true
        // Started at once: the part that can finish before the page is gone runs before this returns
        capturing = captureState(emulator, { canvasThumbnail: launchProfile.canvasThumbnail, immediate: true })
        // Uploaded in the background: the game needn't wait for the network once it's shown again
        // oxlint-disable-next-line typescript/no-floating-promises -- it answers for its own failures
        persistQuietly(capturing)
        return
      }
      if (pausedOnHide) {
        pausedOnHide = false
        // The game resumes once its state is taken, usually long before the page is shown again
        await attemptAsync(async () => await capturing)
        if (emulator.getStatus() === 'paused' && !menuShownRef.current) {
          emulator.resume()
        }
      }
    }

    // In the capture phase on window this runs before the emulator's own listener on document, which stops it once the
    // page is hidden
    globalThis.addEventListener('visibilitychange', handleVisibilityChange, { capture: true })
    return () => globalThis.removeEventListener('visibilitychange', handleVisibilityChange, { capture: true })
  }, [launched, emulator, core, rom, reloadAutoStates, launchProfile, currentDisc])
}
