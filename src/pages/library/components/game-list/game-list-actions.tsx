import { clsx } from 'clsx'
import { delay } from 'es-toolkit'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { twMerge } from 'tailwind-merge'
import { client, parseResponse } from '#@/api/client.ts'
import { DeleteDialog } from '../delete-dialog.tsx'
import { FilterActions } from './filter-actions.tsx'
import { SelectionActions } from './selection-actions.tsx'
import { SelectionInfo } from './selection-info.tsx'
import { useGameListActions } from './use-game-list-actions.ts'

/**
 * Favorites and Sort, or what to do with the selected games; `leading` goes before them, as a console's page puts its
 * game count and Add there, and `trailing` after. `summary`, on a phone, is the page's count at the far left of the line
 */
export function GameListActions({
  className,
  leading,
  summary,
  trailing,
}: Readonly<{ className?: string; leading?: ReactNode; summary?: ReactNode; trailing?: ReactNode }>) {
  const { roms, selectedGames, setSelectedGames, shouldHideActions, hasSelectedGames, canSelectAll } =
    useGameListActions()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const { t } = useTranslation()

  // A shared library's players can search it (with the search in the sidebar), but not change it or filter by favorites
  if (shouldHideActions) {
    return leading || summary ? (
      <div className={twMerge('flex items-center gap-2 px-4', className)} data-sn-section=''>
        <PhoneSummary>{summary}</PhoneSummary>
        {leading}
      </div>
    ) : null
  }

  return (
    <div
      className={twMerge(
        clsx('group/actions flex flex-wrap items-center gap-2 px-4', className, {
          'justify-between': hasSelectedGames,
          'justify-end': !hasSelectedGames,
          // Starting the page on a phone, it lines up with the page's edges
          'max-lg:px-0': summary,
        }),
      )}
      data-crowded={leading || trailing ? '' : undefined}
      data-sn-section=''
    >
      {hasSelectedGames ? (
        <>
          <SelectionInfo
            selectedCount={selectedGames.length}
            canSelectAll={canSelectAll}
            onSelectAll={() => setSelectedGames(roms.map(({ id }) => id))}
          />
          <SelectionActions
            selectedCount={selectedGames.length}
            onDelete={() => setDeleteDialogOpen(true)}
            onCancel={() => setSelectedGames([])}
          />
          <DeleteDialog
            description={t('dialog.confirmDeleteRomsMessage')}
            onConfirm={() => parseResponse(client.roms.$delete({ query: { ids: selectedGames.join(',') } }))}
            onDeleted={async () => {
              await delay(500) // waiting for the animation
              setSelectedGames([])
            }}
            onOpenChange={setDeleteDialogOpen}
            open={deleteDialogOpen}
            title={t('game.deleteSelectedItems', {
              count: selectedGames.length,
              items: t('game.rom', { count: selectedGames.length }),
            })}
          />
        </>
      ) : (
        <>
          <PhoneSummary>{summary}</PhoneSummary>
          <FilterActions leading={leading} trailing={trailing} />
        </>
      )}
    </div>
  )
}

/** The page's count on a phone, at the left of the line; a computer shows it with the page's title instead */
function PhoneSummary({ children }: Readonly<{ children?: ReactNode }>) {
  return children ? (
    <span className='mr-auto text-sm whitespace-nowrap text-(--gray-11) lg:hidden'>{children}</span>
  ) : null
}
