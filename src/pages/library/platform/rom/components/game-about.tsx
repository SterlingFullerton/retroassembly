import { clsx } from 'clsx'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Rom } from '#@/controllers/roms/get-roms.ts'
import { useDate } from '#@/pages/library/hooks/use-date.ts'
import { GameMedia } from './game-media/game-media.tsx'

/** The game's facts as kept for it, or as found for it when it was added */
export function useGameFacts(rom: Rom) {
  const { formatDate, isValidDate } = useDate()
  const launchboxGame = rom.rawGameMetadata?.launchbox || {}
  const releaseDate = rom.gameReleaseDate ?? launchboxGame.releaseDate
  const released = isValidDate(releaseDate) ? new Date(releaseDate) : undefined
  // Stored comma-separated, with or without spaces
  const genres: string[] = ((rom.gameGenres ?? launchboxGame.genres) || '')
    .split(',')
    .map((genre: string) => genre.trim())
    .filter(Boolean)
  return {
    description: (rom.gameDescription || launchboxGame.overview || '') as string,
    developer: ((rom.gameDeveloper ?? launchboxGame.developer) || '').trim() as string,
    genres,
    players: (rom.gamePlayers ?? launchboxGame.maxPlayers) as number | string | undefined,
    publisher: ((rom.gamePublisher ?? launchboxGame.publisher) || '').trim() as string,
    released,
    releasedText: released ? formatDate(releaseDate) : '',
    wikipediaUrl: launchboxGame.wikipediaUrl as string | undefined,
  }
}

/**
 * About the game, folded away until opened, as on a console's page: its description, the details (when it came out, its
 * genres, players, who made and published it), its screenshots and videos, and where to read more
 */
export function GameAbout({ rom }: Readonly<{ rom: Rom }>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const facts = useGameFacts(rom)

  const unknown = <span className='text-(--gray-9)'>{t('common.unknown')}</span>
  const details: [string, ReactNode][] = [
    [t('common.released'), facts.releasedText || unknown],
    [t('common.genres'), facts.genres.join(', ') || unknown],
    [t('common.players'), facts.players || unknown],
    [t('common.developer'), facts.developer || unknown],
    [t('common.publisher'), facts.publisher || unknown],
  ]

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

          <dl className='grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-3'>
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className='text-xs text-(--gray-11)'>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <GameMedia />

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
