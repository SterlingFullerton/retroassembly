import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { generatePath } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import { useSelectedGames } from '../../atoms.ts'
import { useDate } from '../../hooks/use-date.ts'
import { FavoriteButton } from '../favorite-button.tsx'
import { NavigatableLink } from '../navigatable-link.tsx'
import { GameEntryDropdownMenu } from './game-entry-dropdown-menu.tsx'
import { GameEntryImage } from './game-entry-image.tsx'
import { GamePlatform } from './game-platform.tsx'
import { GameTitle } from './game-title.tsx'

export function GameEntry({ rom }) {
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

  return (
    <div className='group relative'>
      <NavigatableLink
        className='game-entry group flex flex-col items-center justify-center gap-1 lg:p-1'
        onClick={handleClick}
        title={selecting ? `Select ${rom.fileName}` : rom.fileName}
        to={url}
      >
        {({ isPending }) => (
          <>
            <GameEntryImage rom={rom} />
            <GamePlatform platform={rom.platform} />
            <GameTitle rom={rom} />
            {lastPlayed ? (
              <div className='-mt-1 text-center text-xs text-(--gray-11)'>{t('game.played', { when: lastPlayed })}</div>
            ) : null}
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
      <FavoriteButton rom={rom} variant='overlay' />
      <GameEntryDropdownMenu rom={rom} />
    </div>
  )
}
