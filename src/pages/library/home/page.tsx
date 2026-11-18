import { useTranslation } from 'react-i18next'
import { generatePath, useLoaderData } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import type { loader } from '#@/pages/routes/library-home.tsx'
import { ConsoleRow } from './components/console-row.tsx'
import { GameRow } from './components/game-row.tsx'
import { HomeEmpty } from './components/home-empty.tsx'
import { HomeHero } from './components/home-hero.tsx'
import { HomeRow } from './components/home-row.tsx'
import { OnThisDayRow } from './components/on-this-day-row.tsx'
import { usePlayTogetherPicks, useRediscoverPicks } from './components/use-home-picks.ts'

// Home: what you're in the middle of and the consoles, then rows that change from visit to visit. A row with nothing in
// it is left out

/** Picks another handful for a row of random picks */
function ShuffleButton({ onClick }: Readonly<{ onClick: () => void }>) {
  const { t } = useTranslation()
  return (
    <button
      className='min-h-6 rounded-full border border-(--accent-6) px-3 text-xs font-semibold text-(--accent-11) hover:bg-(--accent-3)'
      onClick={onClick}
      type='button'
    >
      {t('home.shuffle')}
    </button>
  )
}

export function LibraryHomePage() {
  const { t } = useTranslation()
  const { favoriteRoms, newAddedRoms } = useLoaderData<typeof loader>()
  const rediscover = useRediscoverPicks()
  const playTogether = usePlayTogetherPicks()
  // A game can qualify for both rows; it's shown in Rediscover only
  const shownInRediscover = new Set(rediscover.data?.map(({ id }) => id))
  const playTogetherRoms = playTogether.data?.filter(({ id }) => !shownInRediscover.has(id))

  if (newAddedRoms.length === 0) {
    return <HomeEmpty />
  }

  return (
    // On a computer, the same 32-point margin as the other pages; on a very wide screen, no wider than 1600 points, centred
    <div className='p-4 lg:mx-auto lg:max-w-[1664px] lg:p-8'>
      <h1 className='sr-only'>{t('nav.home')}</h1>
      <HomeHero />
      <ConsoleRow />

      {rediscover.data?.length ? (
        <HomeRow
          extra={<ShuffleButton onClick={() => rediscover.mutate()} />}
          note={t('home.rediscoverNote')}
          title={t('home.rediscover')}
        >
          <GameRow roms={rediscover.data} />
        </HomeRow>
      ) : null}

      <OnThisDayRow />

      {/* Side by side on a computer when there are both; Recently added alone takes the whole width */}
      <div className={favoriteRoms.length > 0 ? 'xl:grid xl:grid-cols-2 xl:gap-8' : ''}>
        {favoriteRoms.length > 0 ? (
          <HomeRow link={generatePath(routes.libraryFavorites)} title={t('nav.favorites')}>
            <GameRow roms={favoriteRoms} />
          </HomeRow>
        ) : null}
        <HomeRow
          link={`${generatePath(routes.libraryRoms)}?${new URLSearchParams({ direction: 'desc', sort: 'added' })}`}
          title={t('home.recentlyAdded')}
        >
          <GameRow roms={newAddedRoms} />
        </HomeRow>
      </div>

      {playTogetherRoms?.length ? (
        <HomeRow
          extra={<ShuffleButton onClick={() => playTogether.mutate()} />}
          note={t('home.playTogetherNote')}
          title={t('home.playTogether')}
        >
          <GameRow
            note={(rom) => (rom.gamePlayers ? t('home.players', { count: rom.gamePlayers }) : undefined)}
            roms={playTogetherRoms}
          />
        </HomeRow>
      ) : null}
    </div>
  )
}
