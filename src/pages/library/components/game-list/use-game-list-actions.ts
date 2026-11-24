import { useLocation } from 'react-router'
import { getDefaultRomsDirection, getListOrder } from '#@/constants/roms-order.ts'
import { usePermissions } from '#@/pages/library/hooks/use-permissions.ts'
import { routes } from '../../../routes.ts'
import { useSelectedGames } from '../../atoms.ts'
import { isSearchablePath } from '../../hooks/use-library-search.ts'
import { useRoms } from '../../hooks/use-roms.ts'

export function useGameListActions() {
  const { roms } = useRoms()
  const [selectedGames, setSelectedGames] = useSelectedGames()
  const { pathname, search } = useLocation()

  const isHistoryPage = pathname === routes.libraryHistory
  const isFavoritesPage = pathname === routes.libraryFavorites
  // Selecting games is for deleting them, which is for admins
  const { canDeleteGames } = usePermissions()
  const shouldHideActions = isHistoryPage || !canDeleteGames

  const searchParams = new URLSearchParams(search)
  // The Games page and a console's page can be searched
  const isSearchable = isSearchablePath(pathname)
  const query = isSearchable ? (searchParams.get('q') ?? '') : ''
  const sort = getListOrder(searchParams.get('sort'), Boolean(query))
  const direction = searchParams.get('direction') || getDefaultRomsDirection(sort)
  const isViewingFavorites = searchParams.get('favorite') === '1'

  const hasRoms = roms.length > 0
  const hasSelectedGames = selectedGames.length > 0
  const canSelectAll = selectedGames.length < roms.length

  // Not on the Games page, which Favorites in the menu already covers; an old link with the filter on still shows it, to
  // turn it off
  const isGamesPage = pathname === routes.libraryRoms
  const showFavoriteButton = (!isFavoritesPage && !isGamesPage && (hasRoms || Boolean(query))) || isViewingFavorites
  const showSortDropdown = hasRoms

  function buildSortLink(params: Record<string, string>) {
    const newParams = new URLSearchParams(params)
    if (isViewingFavorites) {
      newParams.set('favorite', '1')
    }
    if (query) {
      newParams.set('q', query)
    }
    return [pathname, newParams].join('?')
  }

  function getFavoriteToggleLink() {
    const params = new URLSearchParams(search)
    if (isViewingFavorites) {
      params.delete('favorite')
    } else {
      params.set('favorite', '1')
    }
    const query = params.toString()
    return query ? [pathname, query].join('?') : pathname
  }

  return {
    buildSortLink,
    canSelectAll,
    direction,
    getFavoriteToggleLink,
    hasRoms,
    hasSelectedGames,
    isSearchable,
    isViewingFavorites,
    pathname,
    query,
    roms,
    search,
    selectedGames,
    setSelectedGames,
    shouldHideActions,
    showFavoriteButton,
    showSortDropdown,
    sort,
  }
}
