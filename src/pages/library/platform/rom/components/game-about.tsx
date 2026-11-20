import { clsx } from 'clsx'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDate } from '#@/pages/library/hooks/use-date.ts'
import type { Rom } from '#@/pages/library/types.ts'
import { GameMedia } from './game-media/game-media.tsx'

/**
 * The game's facts as stored for it, which includes what was found for it when it was added, so a detail cleared stays
 * cleared. Libretro's data has only a year, used when there's no date. The description isn't stored on adding, so it
 * comes from LaunchBox until one is saved
 */
export function useGameFacts(rom: Rom) {
  const { formatDate, isValidDate } = useDate()
  const launchboxGame = rom.rawGameMetadata?.launchbox || {}
  const released = rom.gameReleaseDate && isValidDate(rom.gameReleaseDate) ? new Date(rom.gameReleaseDate) : undefined
  const year = released ? released.getUTCFullYear() : rom.gameReleaseYear || undefined
  // Stored comma-separated, with or without spaces
  const genres: string[] = (rom.gameGenres || '')
    .split(',')
    .map((genre: string) => genre.trim())
    .filter(Boolean)
  let releasedText = year ? String(year) : ''
  if (released) {
    releasedText = formatDate(released)
  }
  return {
    description: (rom.gameDescription || launchboxGame.overview || '') as string,
    developer: (rom.gameDeveloper || '').trim(),
    genres,
    players: Math.trunc(Number(rom.gamePlayers)) || undefined,
    publisher: (rom.gamePublisher || '').trim(),
    releasedText,
    wikipediaUrl: launchboxGame.wikipediaUrl as string | undefined,
    year,
  }
}

/** When the game came out, its genres, players, and who made and published it: those that are known */
export function GameDetails({ className, rom }: Readonly<{ className?: string; rom: Rom }>) {
  const { t } = useTranslation()
  const facts = useGameFacts(rom)

  const details: [string, ReactNode][] = [
    [t('common.released'), facts.releasedText],
    [t('common.genres'), facts.genres.join(', ')],
    [t('common.players'), facts.players],
    [t('common.developer'), facts.developer],
    [t('common.publisher'), facts.publisher],
  ]
  const known = details.filter(([, value]) => value)
  if (!known.length) {
    return null
  }

  return (
    <dl className={clsx('gap-x-6 gap-y-2 text-sm', className)}>
      {known.map(([label, value]) => (
        <div key={label}>
          <dt className='text-xs text-(--gray-11)'>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * About the game, folded away until opened, as on a console's page. On a phone it holds everything: the description, the
 * details, the screenshots and videos, and where to read more. A computer shows the details and media on the page, so
 * About holds only the description and the link (`descriptionOnly`), and isn't there without them
 */
export function GameAbout({ descriptionOnly = false, rom }: Readonly<{ descriptionOnly?: boolean; rom: Rom }>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const facts = useGameFacts(rom)

  if (descriptionOnly && !facts.description && !facts.wikipediaUrl) {
    return null
  }

  return (
    <div className='mt-4 border-y border-(--gray-a4)'>
      <button
        aria-expanded={open}
        className='flex min-h-10 items-center gap-0.5 font-semibold text-(--accent-11) hover:underline'
        data-sn-enabled
        onClick={() => setOpen(!open)}
        type='button'
      >
        {t('common.about')}
        <span className={clsx('size-4', open ? 'icon-[mdi--chevron-up]' : 'icon-[mdi--chevron-down]')} />
      </button>

      {open ? (
        <div className='flex flex-col gap-4 pb-4'>
          {facts.description ? (
            <p className='max-w-[70ch] text-sm text-pretty whitespace-pre-line text-(--gray-12)'>{facts.description}</p>
          ) : null}

          {descriptionOnly ? null : (
            <>
              <GameDetails className='grid grid-cols-2' rom={rom} />
              <GameMedia />
            </>
          )}

          {facts.wikipediaUrl ? (
            <a
              className='inline-flex items-center gap-2 self-start text-sm text-(--accent-11) underline'
              href={facts.wikipediaUrl}
              rel='noreferrer noopener'
              target='_blank'
            >
              <span className='icon-[mdi--wikipedia] size-5' /> {t('common.readMoreWikipedia')}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
