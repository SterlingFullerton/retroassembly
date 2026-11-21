import { delay } from 'es-toolkit'
import { useGameOverlayPage, useIsGameOverlayPendingAtom, useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { focus } from '#@/pages/library/utils/spatial-navigation.ts'
import { useGameStates } from './use-game-states.ts'

export function useGameOverlay() {
  const [visible, setVisible] = useShowGameOverlayContent()
  const [isPending, setIsPending] = useIsGameOverlayPendingAtom()
  const [page, setPage] = useGameOverlayPage()
  const { emulator } = useSession()
  const { reloadStates } = useGameStates()

  async function show() {
    if (emulator) {
      const status = emulator.getStatus()
      if (status === 'running' || status === 'paused') {
        emulator.pause()
        // The menu always opens on its own page, not its saves
        setPage('main')
        setVisible(true)
        await reloadStates()
      }
    }
  }

  async function hide() {
    if (isPending) {
      return
    }
    setVisible(false)
    focus('canvas')
    await delay(100)
    emulator?.resume()
  }

  /** Opens the saves, with the focus on their Back button */
  async function openSaves() {
    setPage('saves')
    await delay(0)
    focus('.game-overlay-back button')
  }

  /** Opens the settings, with the focus on their Back button */
  async function openSettings() {
    setPage('settings')
    await delay(0)
    focus('.game-overlay-back button')
  }

  /** Goes back from the saves or the settings to the menu, with the focus on the button that opened them */
  async function back() {
    const from = page
    setPage('main')
    await delay(0)
    focus(from === 'settings' ? '.game-overlay-settings' : '.game-overlay-saves')
  }

  // The pause key or buttons go back from the saves or the settings, and close the menu from its own page
  async function toggle() {
    if (visible && page !== 'main') {
      await back()
      return
    }
    await (visible ? hide() : show())
  }

  return { back, hide, isPending, openSaves, openSettings, page, setIsPending, show, toggle, visible }
}
