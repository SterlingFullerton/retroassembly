import { clsx } from 'clsx'
import type { PropsWithChildren } from 'react'
import { GameList, type GameListProps } from './game-list/game-list.tsx'

export function GameListMain({
  actionsInHeader,
  actionsLeading,
  actionsTrailing,
  children,
  phoneSummary,
}: Readonly<PropsWithChildren<GameListProps>>) {
  // No breadcrumb on the lists: where you are is in the red bar (a phone) or the sidebar (a computer). A game's page keeps
  // it, as the way back to its console
  return (
    <div className='flex min-h-full w-full flex-col gap-5 p-4'>
      <div
        className={clsx('relative flex flex-col justify-between pt-4 lg:flex-row lg:px-4', {
          'max-lg:hidden': phoneSummary,
        })}
        data-sn-section=''
      >
        {children}
      </div>
      <GameList
        actionsInHeader={actionsInHeader}
        actionsLeading={actionsLeading}
        actionsTrailing={actionsTrailing}
        phoneSummary={phoneSummary}
      />
    </div>
  )
}
