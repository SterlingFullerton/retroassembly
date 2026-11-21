import { clsx } from 'clsx'
import { type CSSProperties, type ReactNode, useEffect } from 'react'
import { useLocation } from 'react-router'
import { getCoverSize } from '#@/constants/cover-sizes.ts'
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
  /** After Favorites and Sort */
  actionsTrailing?: ReactNode
  /**
   * On a phone, the page's count at the left of the Favorites and Sort line, which then starts the page: the page's own
   * title and count are left out there, its name being in the red bar
   */
  phoneSummary?: ReactNode
  /** On a computer the page shows that line in its own header, so the list leaves it out there */
  actionsInHeader?: boolean
}

export function GameList({ actionsInHeader, actionsLeading, actionsTrailing, phoneSummary }: Readonly<GameListProps>) {
  const { preference } = usePreference()
  const { roms } = useRoms()
  const [, setSelectedGames] = useSelectedGames()

  // A selection is of the games shown: another page, sort, search or console starts with none, so deleting the selected
  // games can't take ones no longer on screen
  const { pathname, search } = useLocation()
  const shown = pathname + search
  useEffect(() => {
    if (shown) {
      setSelectedGames([])
    }
  }, [setSelectedGames, shown])

  // The cover size setting: how narrow a game may be, so more or fewer fit in a row, on a computer and on a phone
  const { list, phoneList } = getCoverSize(preference.ui.libraryCoverSize)
  const gridTemplateColumns = 'repeat(auto-fill,minmax(min(var(--cover-size),100%),1fr))'

  return (
    <div
      className={clsx('flex flex-col border border-transparent border-t-(--gray-6) pt-4', {
        'max-lg:border-t-transparent max-lg:pt-0': phoneSummary,
      })}
    >
      <GameListSearching />
      <GameListActions
        className={actionsInHeader ? 'lg:hidden' : undefined}
        leading={actionsLeading}
        summary={phoneSummary}
        trailing={actionsTrailing}
      />
      {roms?.length ? (
        <div className='mt-4 flex gap-2' data-sn-section=''>
          <div
            className='grid flex-1 gap-x-4 gap-y-6 [--cover-size:var(--phone-cover-size)] lg:gap-x-3 lg:[--cover-size:var(--computer-cover-size)]'
            style={
              {
                '--computer-cover-size': `${list}px`,
                '--phone-cover-size': `${phoneList}px`,
                gridTemplateColumns,
              } as CSSProperties
            }
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
