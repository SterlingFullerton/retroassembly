import type { ReactNode } from 'react'
import { FavoriteButton } from './favorite-button.tsx'
import { SortDropdown } from './sort-dropdown.tsx'
import { useGameListActions } from './use-game-list-actions.ts'

export function FilterActions({ leading }: Readonly<{ leading?: ReactNode }>) {
  const {
    showFavoriteButton,
    showSortDropdown,
    isViewingFavorites,
    getFavoriteToggleLink,
    direction,
    sort,
    buildSortLink,
    query,
  } = useGameListActions()

  return (
    <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>
      {leading}
      {showFavoriteButton && (
        <FavoriteButton isViewingFavorites={isViewingFavorites} getToggleLink={getFavoriteToggleLink} />
      )}
      {showSortDropdown && (
        <SortDropdown
          buildSortLink={buildSortLink}
          currentDirection={direction}
          currentSort={sort}
          searching={Boolean(query)}
        />
      )}
    </div>
  )
}
