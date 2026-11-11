import type { Nostalgist } from 'nostalgist'
import { useEffect } from 'react'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useIsDemo } from '#@/pages/library/hooks/use-demo.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { putPendingSave, uploadPendingSave } from '#@/pages/library/utils/pending-saves.ts'
import { useEmulator } from './use-emulator.ts'
import { forceGetEmulatorThumbnail, useGameStates } from './use-game-states.ts'

interface SavedState {
  state: Blob
  thumbnail: Blob
}

// Browsers stop the animation frames that drive the emulator as soon as a page is hidden, so a normal save would only
// finish once the page is shown again, if it still exists by then. Cores built for this fork (DS) let the page run the
// main loop itself, so the save can finish right away, before the page is gone.
function saveStateNow(emulator: Nostalgist): SavedState | undefined {
  const { Module } = emulator.getEmscripten() as { Module: { runMainLoopIterations?: (count: number) => boolean } }
  const { runMainLoopIterations } = Module
  if (!runMainLoopIterations) {
    return
  }

  const inner = emulator.getEmulator() as unknown as {
    clearStateFile: () => void
    sendCommand: (command: string) => void
    stateFilePath: string
    stateThumbnailFilePath: string
  }
  const fs = emulator.getEmscriptenFS()
  function sizeOf(filePath: string) {
    try {
      return Number(fs.stat(filePath).size)
    } catch {
      return 0
    }
  }

  inner.clearStateFile()
  inner.sendCommand('SAVE_STATE')
  const files = [inner.stateFilePath, inner.stateThumbnailFilePath]
  let lastSizes = ''
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    if (!runMainLoopIterations(1)) {
      return
    }
    // A file is done once it exists and stops growing between iterations
    const sizes = files.map((file) => sizeOf(file))
    const key = sizes.join(',')
    if (sizes.every(Boolean) && key === lastSizes) {
      const [state, thumbnail] = files.map(
        (file) =>
          new Blob([fs.readFile(file) as Uint8Array<ArrayBuffer>], {
            type: file.endsWith('.png') ? 'image/png' : 'application/octet-stream',
          }),
      )
      inner.clearStateFile()
      return { state, thumbnail }
    }
    lastSizes = key
  }
}

// Mobile browsers often unload a page soon after you switch to another app, which loses the game. When the page is
// hidden, pause the game and save it, first in the browser and then to the server, and resume it if the page comes back.
export function useSaveOnHide() {
  const { core, emulator } = useEmulator()
  const rom = useRom()
  const [launched] = useEmulatorLaunched()
  const isDemo = useIsDemo()
  const { reloadAutoStates } = useGameStates()

  useEffect(() => {
    if (!launched || !emulator || !core || !rom || isDemo) {
      return
    }

    let pausedOnHide = false
    let saving: Promise<void> | undefined

    async function persist(saved: SavedState | undefined) {
      if (!emulator || !core || !rom) {
        return
      }
      let result = saved
      if (!result) {
        const fallback = await emulator.saveState()
        const thumbnail =
          core === 'mupen64plus_next'
            ? await forceGetEmulatorThumbnail(emulator, { height: 3, width: 4 })
            : (fallback.thumbnail as Blob)
        result = { state: fallback.state, thumbnail }
      }
      const pending = { core, rom: rom.id, savedAt: Date.now(), ...result }
      try {
        await putPendingSave(pending)
      } catch {}
      await uploadPendingSave(pending)
      await reloadAutoStates()
    }

    // A save that fails to upload stays in the browser and is uploaded the next time the library opens
    async function persistQuietly(saved: SavedState | undefined) {
      try {
        await persist(saved)
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
        let saved: SavedState | undefined
        try {
          saved = saveStateNow(emulator)
        } catch {}
        saving = persistQuietly(saved)
        return
      }
      if (pausedOnHide) {
        pausedOnHide = false
        await saving
        if (emulator.getStatus() === 'paused') {
          emulator.resume()
        }
      }
    }

    // In the capture phase on window this runs before the emulator's own listener on document, which stops it once the
    // page is hidden
    globalThis.addEventListener('visibilitychange', handleVisibilityChange, { capture: true })
    return () => globalThis.removeEventListener('visibilitychange', handleVisibilityChange, { capture: true })
  }, [launched, emulator, core, rom, isDemo, reloadAutoStates])
}
