import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import type { loader } from '#@/pages/routes/library-platform-rom.tsx'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { FavoriteButton } from '../../components/favorite-button.tsx'
import { GameButtons } from '../../components/game-buttons/game-buttons.tsx'
import { RomBackground } from '../../components/rom-background.tsx'
import { useViewport } from '../../hooks/use-viewport.ts'
import { DownloadButton } from './components/download-button.tsx'
import { GameAbout, useGameFacts } from './components/game-about.tsx'
import { GameCover } from './components/game-cover.tsx'
import { GameInfoDialog } from './components/game-info-dialog/game-info-dialog.tsx'

/**
 * A game's page. The box art keeps its own shape within a fixed height: on a phone beside the title, so Continue and
 * Start are on the first screen; on a computer in a column of its own. Under the title, its console, year and genre, and
 * Favorite, Download and Edit. About, folded away, holds the rest
 */
export default function RomPage() {
  const { t } = useTranslation()
  const { isLargeScreen } = useViewport()
  const { discs, rom } = useLoaderData<typeof loader>()
  const facts = useGameFacts(rom)

  const goodcodes = getRomGoodcodes(rom)
  const factLine = [
    t(platformMap[rom.platform].displayNameI18nKey),
    facts.released ? String(facts.released.getUTCFullYear()) : '',
    facts.genres[0] ?? '',
    discs.length > 1 ? t('emulator.discCount', { count: discs.length }) : '',
  ].filter(Boolean)

  const buttons = (
    <div className='flex shrink-0 items-center gap-2'>
      <FavoriteButton rom={rom} variant='inline' />
      <DownloadButton rom={rom} />
      <GameInfoDialog />
    </div>
  )

  return (
    <>
      <RomBackground rom={rom} />

      <div className='relative'>
        <div className='flex min-h-full w-full flex-col gap-4 p-4 md:flex-row md:gap-8 lg:p-6'>
          <div className='flex items-start gap-4 md:block md:w-56 md:shrink-0 lg:w-64'>
            <GameCover
              className='max-w-[48%] shrink-0 md:sticky md:top-4 md:max-w-full'
              imgClassName='block h-auto max-h-42 w-auto max-w-full rounded-md shadow-md md:mx-auto md:max-h-88'
              parallax={isLargeScreen}
              rom={rom}
            />

            {/* On a phone, the title and the rest of the top sit beside the cover */}
            <div className='flex min-w-0 flex-1 flex-col gap-1.5 md:hidden'>
              <h1 className='text-xl leading-tight font-bold'>{goodcodes.rom}</h1>
              <FactLine facts={factLine} />
              <div className='mt-1'>{buttons}</div>
            </div>
          </div>

          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <div className='hidden items-center gap-4 md:flex'>
              <h1 className='text-3xl font-bold'>{goodcodes.rom}</h1>
              {buttons}
            </div>
            <div className='hidden md:block'>
              <FactLine facts={factLine} />
            </div>

            <div className='mt-1 md:mt-4 md:max-w-3xl'>
              {/* On a phone, Continue and Start side by side and smaller, as on Home, so the first screen holds more */}
              <GameButtons beforeSaves={<GameAbout rom={rom} />} compact={!isLargeScreen} lazy saves />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function FactLine({ facts }: Readonly<{ facts: string[] }>) {
  return (
    <div className='flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-(--gray-11)'>
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
    </div>
  )
}
