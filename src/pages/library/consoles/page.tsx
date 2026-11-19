import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { generatePath, useLoaderData, useSearchParams } from 'react-router'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { routes } from '#@/pages/routes.ts'
import type { loader } from '#@/pages/routes/library-consoles.tsx'
import { getPlatformBanner, getPlatformDevicePhoto, getPlatformIcon } from '#@/utils/client/library.ts'
import { type SortOption, SortDropdown } from '../components/game-list/sort-dropdown.tsx'
import { NavigatableLink } from '../components/navigatable-link.tsx'
import { usePreference } from '../hooks/use-preference.ts'

/** The console's photo, or its logo where there's no photo */
function ConsolePicture({ name, platform }: Readonly<{ name: string; platform: PlatformName }>) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <img alt={name} className='size-full object-contain p-6' loading='lazy' src={getPlatformBanner(platform)} />
  ) : (
    <img
      alt={name}
      className='size-full object-contain drop-shadow-lg transition-transform group-hover:scale-105'
      loading='lazy'
      onError={() => setFailed(true)}
      src={getPlatformDevicePhoto(platform)}
    />
  )
}

const consoleOrders = ['name', 'released', 'manufacturer', 'games'] as const
type ConsoleOrder = (typeof consoleOrders)[number]

/** Most games reads from the top; the rest from A, or the oldest */
function getDefaultConsolesDirection(order: string) {
  return order === 'games' ? 'desc' : 'asc'
}

/** Every console in the library, A to Z as in the sidebar unless sorted otherwise, each a card with its photo, opening its games */
export default function ConsolesPage() {
  const { consoles } = useLoaderData<typeof loader>()
  const { preference } = usePreference()
  const { i18n, t } = useTranslation()
  const format = new Intl.NumberFormat(i18n.language)

  const [searchParams] = useSearchParams()
  const sort: ConsoleOrder = consoleOrders.find((order) => order === searchParams.get('sort')) ?? 'name'
  const direction =
    searchParams.get('direction') === 'desc' || searchParams.get('direction') === 'asc'
      ? (searchParams.get('direction') as string)
      : getDefaultConsolesDirection(sort)

  function buildSortLink(params: Record<string, string>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(params)) {
      next.set(key, value)
    }
    return `?${next}`
  }

  const sortOptions: SortOption[] = [
    { icon: 'icon-[mdi--pencil]', label: t('common.name'), value: 'name' },
    { icon: 'icon-[mdi--calendar]', label: t('common.released'), value: 'released' },
    { icon: 'icon-[mdi--factory]', label: t('common.manufacturer'), value: 'manufacturer' },
    { icon: 'icon-[mdi--gamepad-variant]', label: t('common.numberOfGames'), value: 'games' },
  ]

  const counts = new Map(consoles.map(({ count, platform }) => [platform, count]))
  const cards = preference.ui.platforms
    .filter((platform) => platform in platformMap)
    .map((platform) => ({
      count: counts.get(platform) ?? 0,
      name: t(platformMap[platform].displayNameI18nKey),
      platform,
    }))
    .toSorted((a, b) => {
      const byName = a.name.localeCompare(b.name, i18n.language)
      const byRelease = platformMap[a.platform].info.releaseDate.localeCompare(platformMap[b.platform].info.releaseDate)
      const order = {
        games: a.count - b.count || -byName,
        // Each maker's consoles, oldest first
        manufacturer:
          (platformMap[a.platform].info.manufacturer ?? '').localeCompare(
            platformMap[b.platform].info.manufacturer ?? '',
            i18n.language,
          ) || byRelease,
        name: byName,
        released: byRelease || byName,
      }[sort]
      return direction === 'desc' ? -order : order
    })

  return (
    <div className='p-4 lg:mx-auto lg:max-w-[1664px] lg:p-8'>
      {/* On a phone the page's name is in the red bar, so only the count and Sort, on one line */}
      <div className='mb-4 flex items-end justify-between gap-3 lg:mb-5' data-sn-section=''>
        <div>
          <h1 className='text-3xl font-bold max-lg:hidden'>{t('nav.consoles')}</h1>
          <p className='text-sm text-(--gray-11) lg:mt-1'>
            {format.format(cards.length)} {t('home.statConsoles', { count: cards.length })}
          </p>
        </div>
        <SortDropdown
          buildSortLink={buildSortLink}
          currentDirection={direction}
          currentSort={sort}
          getDefaultDirection={getDefaultConsolesDirection}
          options={sortOptions}
        />
      </div>

      <div
        data-sn-section=''
        className='grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] lg:gap-4'
      >
        {cards.map(({ count, name, platform }) => (
          <NavigatableLink
            className='group flex flex-col overflow-hidden rounded-lg border border-(--gray-5) bg-(--color-background) hover:border-(--accent-7)'
            key={platform}
            to={generatePath(routes.libraryPlatform, { platform })}
          >
            <div className='aspect-[16/10] overflow-hidden bg-linear-to-br from-(--gray-2) to-(--gray-4) p-3.5'>
              <ConsolePicture name={name} platform={platform} />
            </div>
            <div className='flex items-center gap-2 px-3 pt-2.5 pb-3'>
              <img alt='' className='size-6 shrink-0 object-contain' src={getPlatformIcon(platform)} />
              <div className='min-w-0'>
                <div className='leading-tight font-semibold'>{name}</div>
                <div className='text-xs text-(--gray-11)'>
                  {t('home.gameCount', { count, formatted: format.format(count) })}
                </div>
              </div>
            </div>
          </NavigatableLink>
        ))}
      </div>
    </div>
  )
}
