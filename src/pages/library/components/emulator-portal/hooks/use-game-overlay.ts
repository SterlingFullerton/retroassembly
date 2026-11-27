import { delay } from 'es-toolkit'
import { useGameOverlayPage, useIsGameOverlayPendingAtom, useShowGameOverlayContent } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { focusPauseMenu, type PauseMenuPage } from '#@/pages/library/components/pause-menu/pause-menu.tsx'
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

  /** Opens a page of the menu, with the focus on its first item */
  async function open(next: Exclude<PauseMenuPage, 'main'>) {
    setPage(next)
    await delay(0)
    focusPauseMenu(next)
  }

  /** Goes back from a page to the menu, with the focus on the item that opened it */
  async function back() {
    const from = page
    setPage('main')
    await delay(0)
    focusPauseMenu('main', from)
  }

  // The pause key or buttons go back from the saves or the settings, and close the menu from its own page
  async function toggle() {
    if (visible && page !== 'main') {
      await back()
      return
    }
    await (visible ? hide() : show())
  }

  return { back, hide, isPending, open, page, setIsPending, show, toggle, visible }
}
