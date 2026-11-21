import { useEffect, useRef } from 'react'
import { useShowGameOverlayContent, useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useGameStates } from './use-game-states.ts'

// How soon a save that found the game not running is tried again
const retryMs = 1000

export function useAutosave() {
  const { emulator } = useSession()
  const { preference } = usePreference()
  const { saveAutoState } = useGameStates()
  const showGameOverlay = useShowGameOverlayContent()
  const overlayVisible = showGameOverlay[0]
  const [launched] = useEmulatorLaunched()

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const nextSaveAtRef = useRef<number | null>(null)
  const intervalSeconds = preference.emulator.autoSaveInterval
  const isDisabled = intervalSeconds === 0
  // The timer outlives the render that set it, so it reads the game and the save as they are when it fires
  const latest = useRef({ active: false, emulator, intervalSeconds, saveAutoState })
  useEffect(() => {
    latest.current = { active: !isDisabled && launched, emulator, intervalSeconds, saveAutoState }
  })

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (isDisabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    if (!launched) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    async function triggerAutosave() {
      // Turned off, or the game left, since the timer was set
      if (!latest.current.active) {
        timeoutRef.current = null
        return
      }
      // A game that isn't running just now, such as one paused while its tab is in the background, is looked at again
      // shortly, rather than never saved again
      if (latest.current.emulator?.getStatus() !== 'running') {
        nextSaveAtRef.current = Date.now() + retryMs
        timeoutRef.current = setTimeout(triggerAutosave, retryMs)
        return
      }

      try {
        await latest.current.saveAutoState()
      } catch {}

      if (!latest.current.active) {
        timeoutRef.current = null
        return
      }
      const ms = latest.current.intervalSeconds * 1000
      nextSaveAtRef.current = Date.now() + ms
      timeoutRef.current = setTimeout(triggerAutosave, ms)
    }

    if (overlayVisible) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        pausedAtRef.current = Date.now()
      }
    } else if (!timeoutRef.current) {
      const delay = (() => {
        if (pausedAtRef.current !== null && nextSaveAtRef.current !== null) {
          const elapsedBeforePause = pausedAtRef.current - (nextSaveAtRef.current - intervalSeconds * 1000)
          const remainingTime = intervalSeconds * 1000 - elapsedBeforePause
          return Math.max(0, remainingTime)
        }
        return intervalSeconds * 1000
      })()

      pausedAtRef.current = null
      nextSaveAtRef.current = Date.now() + delay
      timeoutRef.current = setTimeout(triggerAutosave, delay)
    }
  }, [intervalSeconds, isDisabled, overlayVisible, launched])
}
