import { Skeleton } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { generatePath, Link } from 'react-router'
import { Fragment } from 'react/jsx-runtime'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { skeletonClassnames } from '#@/pages/library/constants/skeleton-classnames.ts'
import { useRomCover } from '#@/pages/library/hooks/use-rom-cover.ts'
import { routes } from '#@/pages/routes.ts'
import { getPlatformIcon, getRomGoodcodes } from '#@/utils/client/library.ts'
import { getSearchMatchRanges } from '#@/utils/isomorphic/search.ts'

type CoverRom = Parameters<typeof useRomCover>[0]

/** A game as search results and recently played games both have it: enough for its row */
export interface ResultRom {
  fileName: null | string
  id: string
  isFavorite?: boolean
  platform: string
}

interface PhoneSearchResultProps {
  /** What was searched for, highlighted in the name */
  keyword: string
  onOpen?: () => void
  rom: ResultRom
}

/** One game in the phone's search screen: its cover, name and console, opening the game's page */
export function PhoneSearchResult({ keyword, onOpen, rom }: Readonly<PhoneSearchResultProps>) {
  const { t } = useTranslation()
  const { data: cover, isLoading } = useRomCover(rom as unknown as CoverRom)
  const title = getRomGoodcodes(rom as unknown as CoverRom).rom
  const platform = rom.platform as PlatformName
  const fileName = rom.fileName ?? ''

  const parts: { highlighted: boolean; text: string }[] = []
  let position = 0
  for (const [start, end] of keyword ? getSearchMatchRanges(title, keyword) : []) {
    parts.push(
      { highlighted: false, text: title.slice(position, start) },
      { highlighted: true, text: title.slice(start, end) },
    )
    position = end
  }
  parts.push({ highlighted: false, text: title.slice(position) })

  const platformName = t(platformMap[platform].displayNameI18nKey)

  return (
    <li className='border-b border-(--gray-4) last:border-b-0'>
      <Link
        className='flex items-center gap-3 py-2'
        onClick={onOpen}
        title={fileName}
        to={generatePath(routes.libraryPlatformRom, { fileName, platform })}
      >
        {isLoading ? (
          <div className='flex size-12 shrink-0 items-center justify-center'>
            <Skeleton className={skeletonClassnames[platform] || 'aspect-square! size-full!'} loading />
          </div>
        ) : (
          <img alt={title} className='size-12 shrink-0 rounded object-contain object-center' src={cover?.src || ''} />
        )}
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='truncate text-(--gray-12)'>
            {parts.map(({ highlighted, text }, index) => (
              <Fragment key={index}>{highlighted ? <span className='text-(--accent-11)'>{text}</span> : text}</Fragment>
            ))}
          </div>
          <div className='flex items-center gap-1 text-xs text-(--gray-11)'>
            <img alt={platformName} className='block size-4 object-contain' src={getPlatformIcon(platform)} />
            {platformName}
          </div>
        </div>
        {rom.isFavorite ? <span className='icon-[mdi--heart] mr-1 shrink-0 text-(--accent-11)' /> : null}
      </Link>
    </li>
  )
}
