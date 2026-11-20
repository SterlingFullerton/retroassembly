import { Trans, useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import type { clientLoader as loader } from '#@/pages/routes/library-favorites.tsx'
import { GameListMain } from '../components/game-list-main.tsx'
import { PageStats } from '../components/page-stats.tsx'

export default function FavoritesPage() {
  const { i18n, t } = useTranslation()
  const { pagination, roms } = useLoaderData<typeof loader>()
  const gameLabel = t('common.game', { count: pagination.total })

  if (pagination.current > 1 && roms.length === 0) {
    return <>{t('error.notFoundCode')}</>
  }

  return (
    <GameListMain
      phoneSummary={t('home.gameCount', {
        count: pagination.total,
        formatted: pagination.total.toLocaleString(i18n.language),
      })}
    >
      <h1 className='text-5xl font-semibold'>{t('nav.favorites')}</h1>
      <PageStats>
        <span className='icon-[mdi--heart] text-(--color-text)' />
        <span>
          <Trans
            components={{
              1: <span className='font-semibold text-(--accent-11)' />,
            }}
            i18nKey='stats.favoriteGames'
            values={{
              game: gameLabel,
              gameCount: pagination.total,
            }}
          />
        </span>
      </PageStats>
    </GameListMain>
  )
}
