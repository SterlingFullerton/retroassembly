import { Trans, useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import type { clientLoader as loader } from '#@/pages/routes/library-history.tsx'
import { GameListMain } from '../components/game-list-main.tsx'
import { PageStats } from '../components/page-stats.tsx'

export default function HistoryPage() {
  const { i18n, t } = useTranslation()
  const { page, pagination, roms, title } = useLoaderData<typeof loader>()
  const gameLabel = t('common.game', { count: pagination.total })
  // Written as the language writes numbers; the count itself picks the word's form
  const gameCount = pagination.total.toLocaleString(i18n.language)

  if (page > 1 && roms.length === 0) {
    return <>{t('error.notFoundCode')}</>
  }

  return (
    <GameListMain
      phoneSummary={
        <Trans components={{ 1: <span /> }} i18nKey='stats.playedGames' values={{ game: gameLabel, gameCount }} />
      }
    >
      <h1 className='text-5xl font-semibold'>{title}</h1>
      <PageStats>
        <span className='icon-[mdi--bar-chart] text-(--color-text)' />
        <span>
          <Trans
            components={{
              1: <span className='font-bold text-(--accent-11)' />,
            }}
            i18nKey='stats.playedGames'
            values={{ game: gameLabel, gameCount }}
          />
        </span>
      </PageStats>
    </GameListMain>
  )
}
