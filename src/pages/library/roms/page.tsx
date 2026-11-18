import { Trans, useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import type { loader } from '#@/pages/routes/library-roms.tsx'
import { GameListMain } from '../components/game-list-main.tsx'
import { GameListActions } from '../components/game-list/game-list-actions.tsx'
import { PageStats } from '../components/page-stats.tsx'
import { UploadSelectButton } from '../platform/components/upload-select-button.tsx'

export default function LibraryROMsPage() {
  const { t } = useTranslation()
  const { pagination, platformCount, roms, search } = useLoaderData<typeof loader>()
  const gameLabel = t('common.game', { count: pagination.total })
  const platformLabel = t('common.platform', { count: platformCount })

  if (pagination.current > 1 && roms.length === 0) {
    return <>404</>
  }

  return (
    // Favorites and Sort sit in the header on a computer, as on a console's page
    <GameListMain actionsInHeader>
      <div>
        <h1 className='text-5xl font-semibold'>{t('common.games')}</h1>
      </div>

      <PageStats
        suffix={
          <div className='flex items-center gap-2'>
            <UploadSelectButton />
            <GameListActions className='hidden px-0 lg:flex' />
          </div>
        }
      >
        {/* While searching, how many match is in the sidebar and above the results instead */}
        {search ? null : (
          <>
            <span className='icon-[mdi--bar-chart] text-(--color-text)' />
            <span>
              <Trans
                components={{
                  1: <span className='font-semibold text-(--accent-11)' />,
                  3: <span className='font-semibold text-(--accent-11)' />,
                }}
                i18nKey='stats.totalGames'
                values={{
                  game: gameLabel,
                  gameCount: pagination.total,
                  platform: platformLabel,
                  platformCount,
                }}
              />
            </span>
          </>
        )}
      </PageStats>
    </GameListMain>
  )
}
