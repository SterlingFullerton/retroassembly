import { clsx } from 'clsx'
import { compact } from 'es-toolkit'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { generatePath } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { useSelectedGames } from '../../atoms.ts'
import { useDate } from '../../hooks/use-date.ts'
import { FavoriteButton } from '../favorite-button.tsx'
import { NavigatableLink } from '../navigatable-link.tsx'
import { GameEntryDropdownMenu } from './game-entry-dropdown-menu.tsx'
import { GameEntryImage } from './game-entry-image.tsx'
import { GamePlatform } from './game-platform.tsx'
import { GameTitle } from './game-title.tsx'

// The highlight around a game has a card's corners
const focusStyle = JSON.stringify({ borderRadius: 'var(--radius-4)' })

export interface GameEntryLabel {
  /** An icon in place of words, where the label would be long */
  icon?: string
  text: string
  /** What the label says in full, on hover */
  title?: string
}

/** A game in a list or a row of Home; `label` adds one of its own to the console line, such as how many can play */
export function GameEntry({ label, rom }: Readonly<{ label?: GameEntryLabel; rom: any }>) {
  const [selectedGames, setSelectedGames] = useSelectedGames()
  const { t } = useTranslation()
  const { formatDateRelative } = useDate()
  // Only History's games have lastLaunched
  const lastPlayed = rom.lastLaunched ? formatDateRelative(rom.lastLaunched) : ''

  const url = generatePath(routes.libraryPlatformRom, {
    fileName: rom.fileName,
    platform: rom.platform,
  })
  const selecting = selectedGames.length > 0
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (selecting) {
      event.preventDefault()
      setSelectedGames(
        selectedGames.includes(rom.id) ? selectedGames.filter((id) => id !== rom.id) : [...selectedGames, rom.id],
      )
    }
  }

  // Labels on the console line: the revision and version from the file name, how many discs, and any of the row's own
  const { revision, version = {} } = getRomGoodcodes(rom).codes
  const labels: GameEntryLabel[] = [
    ...compact([
      revision ? `Rev ${revision}` : '',
      ...Object.keys(version)
        .filter((text) => text !== 'stable')
        .map((text) => text.charAt(0).toUpperCase() + text.slice(1)),
      rom.discCount > 1 ? t('emulator.discCount', { count: rom.discCount }) : '',
    ]).map((text) => ({ text })),
    ...(label ? [label] : []),
  ]

  // The cover and name open the game; under them, the console line with any labels and the heart, then when it was
  // last played
  return (
    <div className='group relative flex flex-col'>
      {/* The highlight, and scrolling into view, take in the whole game: its console line and labels too */}
      <NavigatableLink
        className='game-entry group flex flex-col gap-2 lg:p-1'
        data-sn-focus-parent
        data-sn-focus-style={focusStyle}
        onClick={handleClick}
        title={selecting ? `Select ${rom.fileName}` : rom.fileName}
        to={url}
      >
        {({ isPending }) => (
          <>
            <GameEntryImage framed rom={rom} />
            <GameTitle rom={rom} />
            {isPending ? (
              <div className='absolute inset-0 z-1 hidden bg-(--color-background)/50 group-focus:block'>
                <div className='flex aspect-square w-full items-center justify-center'>
                  <div className='flex rounded-full bg-(--color-background) p-2 ring-1 ring-(--gray-4)'>
                    <span className='icon-[svg-spinners--180-ring] text-(--accent-9)' />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </NavigatableLink>
      <div className='flex min-h-8 min-w-0 items-center gap-1.5 text-xs text-(--gray-11) lg:px-1'>
        <GamePlatform iconOnly={Boolean(label)} platform={rom.platform} />
        {labels.map(({ icon, text, title }) => (
          <span
            className='flex shrink-0 items-center gap-0.5 rounded border border-(--gray-6) px-1.5 text-[11px] leading-4'
            key={text}
            title={title}
          >
            {icon ? <span className={clsx('size-3', icon)} /> : null}
            {text}
          </span>
        ))}
        <FavoriteButton rom={rom} variant='entry' />
      </div>
      {lastPlayed ? (
        <div className='-mt-1.5 text-xs text-(--gray-11) lg:px-1'>{t('game.played', { when: lastPlayed })}</div>
      ) : null}
      <GameEntryDropdownMenu rom={rom} />
    </div>
  )
}
