import { type ReactNode, useEffect } from 'react'
import { useSelectedGames } from '../../atoms.ts'
import { usePreference } from '../../hooks/use-preference.ts'
import { useRoms } from '../../hooks/use-roms.ts'
import { GameEntry } from '../game-entry/game-entry.tsx'
import { GameListActions } from './game-list-actions.tsx'
import { GameListEmpty } from './game-list-empty.tsx'
import { GameListLetters, letterOf } from './game-list-letters.tsx'
import { GameListPagination } from './game-list-pagination.tsx'
import { GameListSearching } from './game-list-searching.tsx'

export interface GameListProps {
  /** At the start of the Favorites and Sort line */
  actionsLeading?: ReactNode
  /** On a computer the page shows that line in its own header, so the list leaves it out there */
  actionsInHeader?: boolean
}

export function GameList({ actionsInHeader, actionsLeading }: Readonly<GameListProps>) {
  const { preference } = usePreference()
  const { roms } = useRoms()
  const [, setSelectedGames] = useSelectedGames()

  useEffect(() => {
    setSelectedGames([])
  }, [setSelectedGames])

  const sizeMap = { 'extra-large': 60, 'extra-small': 36, large: 54, medium: 48, small: 42 }
  const size = sizeMap[preference.ui.libraryCoverSize]
  const gridTemplateColumns = `repeat(auto-fill,minmax(min(calc(var(--spacing)*${size}),var(--min-width)),1fr))`

  return (
    <div className='flex flex-col border border-transparent border-t-(--gray-6) pt-4'>
      <GameListSearching />
      <GameListActions className={actionsInHeader ? 'lg:hidden' : undefined} leading={actionsLeading} />
      {roms?.length ? (
        <div className='mt-4 flex gap-2' data-sn-section=''>
          <div
            className='grid flex-1 gap-x-3 [--min-width:120px] sm:[--min-width:150px] lg:gap-x-0 lg:[--min-width:100%]'
            style={{ gridTemplateColumns }}
          >
            {roms.map((rom) => (
              <GameEntry key={rom.id} rom={rom} />
            ))}
          </div>
          <GameListLetters current={letterOf(roms[0]?.fileName ?? undefined)} />
        </div>
      ) : (
        <GameListEmpty />
      )}
      <GameListPagination />
    </div>
  )
}
