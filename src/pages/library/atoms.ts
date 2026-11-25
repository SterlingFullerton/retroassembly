import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { type CSSProperties, useMemo } from 'react'

const focusIndicatorStyleAtom = atom<CSSProperties>({})
export function useFocusIndicatorStyle() {
  return useAtom(focusIndicatorStyleAtom)
}

export const showGameOverlayContentAtom = atom(false)
// Which page of the pause menu is open: the menu itself, or its saves
const gameOverlayPageAtom = atom<'main' | 'saves' | 'settings'>('main')
export function useGameOverlayPage() {
  return useAtom(gameOverlayPageAtom)
}

export function useShowGameOverlayContent() {
  return useAtom(showGameOverlayContentAtom)
}

const emulatorLaunchedAtom = atom(false)
export function useEmulatorLaunched() {
  return useAtom(emulatorLaunchedAtom)
}

const spatialNavigationPaused = atom(false)
export function useSpatialNavigationPaused() {
  return useAtom(spatialNavigationPaused)
}

const selectedGamesAtom = atom<string[]>([])
export function useSelectedGames() {
  return useAtom(selectedGamesAtom)
}

// For a game in a list: whether any are selected and whether it is, so selecting one redraws it alone, not the page
const isSelectingAtom = atom((get) => get(selectedGamesAtom).length > 0)
export function useGameSelection(id: string) {
  const selecting = useAtomValue(isSelectingAtom)
  const selected = useAtomValue(useMemo(() => atom((get) => get(selectedGamesAtom).includes(id)), [id]))
  const setSelectedGames = useSetAtom(selectedGamesAtom)

  function setSelected(next: boolean) {
    setSelectedGames((games) =>
      next ? [...games.filter((game) => game !== id), id] : games.filter((game) => game !== id),
    )
  }

  return { selected, selecting, setSelected }
}

const pristineAtom = atom(true)
export function usePristine() {
  return useAtom(pristineAtom)
}

const isGameOverlayPendingAtom = atom(false)
export function useIsGameOverlayPendingAtom() {
  return useAtom(isGameOverlayPendingAtom)
}

const launchButtonAtom = atom<HTMLButtonElement>()
export function useLaunchButton() {
  return useAtom(launchButtonAtom)
}

const isFullscreenAtom = atom(false)
export function useIsFullscreen() {
  return useAtom(isFullscreenAtom)
}
