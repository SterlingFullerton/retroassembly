import { DateTime } from 'luxon'
import { useTranslation } from 'react-i18next'
import { generatePath, Link, useLoaderData } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import { useRomCover } from '#@/pages/library/hooks/use-rom-cover.ts'
import { routes } from '#@/pages/routes.ts'
import type { loader } from '#@/pages/routes/library-home.tsx'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { GameButtons } from '../../components/game-buttons/game-buttons.tsx'
import { GameEntryImage } from '../../components/game-entry/game-entry-image.tsx'

type InProgressRom = Awaited<ReturnType<typeof loader>>['inProgressRoms'][number]

function useAgo() {
  const { i18n } = useTranslation()
  return (value: Date | null | number | string | undefined) =>
    value ? DateTime.fromJSDate(new Date(value)).toRelative({ locale: i18n.language }) : undefined
}

function romPath(rom: { fileName: string; platform: string }) {
  return generatePath(routes.libraryPlatformRom, { fileName: rom.fileName, platform: rom.platform })
}

/** A small cover for "Also in progress" */
function SmallCover({ rom }: Readonly<{ rom: InProgressRom }>) {
  const { data: cover } = useRomCover(rom as never)
  return cover?.src ? (
    <img alt='' className='size-10 shrink-0 rounded object-cover' loading='lazy' src={cover.src} />
  ) : (
    <span className='size-10 shrink-0 rounded bg-white/15' />
  )
}

/**
 * The other games with saves, newest first: at the banner's right on a wide screen, in a row of their own under it on a
 * phone or a computer under 1280 points wide, where the banner has no room for it
 */
function AlsoInProgress({ layout, roms }: Readonly<{ layout: 'panel' | 'row'; roms: InProgressRom[] }>) {
  const { t } = useTranslation()
  const ago = useAgo()
  if (layout === 'panel') {
    return (
      <div className='ml-auto hidden w-72 shrink-0 self-stretch rounded-lg bg-black/25 p-3 xl:block'>
        <div className='mb-1 text-xs tracking-wider uppercase opacity-75'>{t('home.alsoInProgress')}</div>
        {roms.slice(0, 3).map((rom) => (
          <Link
            className='flex items-center gap-3 border-t border-white/15 py-2 first-of-type:border-t-0 hover:bg-white/5'
            key={rom.id}
            to={romPath(rom)}
          >
            <SmallCover rom={rom} />
            <div className='min-w-0 text-sm'>
              <div className='truncate'>{getRomGoodcodes(rom as never).rom}</div>
              <div className='text-xs opacity-70'>{t('home.saved', { when: ago(rom.lastSaved) })}</div>
            </div>
          </Link>
        ))}
      </div>
    )
  }
  return (
    <div className='mt-3 xl:hidden' data-sn-section=''>
      <div className='mb-1.5 px-1 text-sm font-semibold'>{t('home.alsoInProgress')}</div>
      <div className='scrollbar-on-hover -mx-4 flex gap-2 overflow-x-auto px-4 pb-1'>
        {roms.map((rom) => (
          <Link
            className='flex w-52 shrink-0 items-center gap-2 rounded-lg border border-(--gray-5) p-1.5 pr-3'
            key={rom.id}
            to={romPath(rom)}
          >
            <SmallCover rom={rom} />
            <div className='min-w-0 text-sm'>
              <div className='truncate font-medium'>{getRomGoodcodes(rom as never).rom}</div>
              <div className='truncate text-xs text-(--gray-11)'>{t('home.saved', { when: ago(rom.lastSaved) })}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * The top of Home: the game to continue, over its own artwork, with Continue and Start; and the other games with saves
 */
export function HomeHero() {
  const { heroReason, inProgressRoms, rom, state } = useLoaderData<typeof loader>()
  const { t } = useTranslation()
  const ago = useAgo()
  const { data: cover } = useRomCover(rom as never)

  if (!rom) {
    return null
  }

  const art = cover?.type === 'rom' ? cover.src : undefined
  const platformName = t(platformMap[rom.platform].displayNameI18nKey)
  const when = ago(state?.createdAt)
  const heading = {
    added: t('home.recentlyAdded'),
    played: t('home.lastPlayed'),
    saved: t('home.continuePlaying'),
  }[heroReason]

  return (
    <>
      <section className='relative overflow-clip rounded-xl bg-[#1b1b2b] text-white' data-sn-section=''>
        {art ? (
          <img alt='' className='absolute inset-0 size-full scale-110 object-cover opacity-50 blur-md' src={art} />
        ) : null}
        <div className='absolute inset-0 bg-linear-to-r from-[#1b1b2b] via-[#1b1b2b]/85 to-[#1b1b2b]/40' />

        <div className='relative flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-6'>
          <div className='flex items-center gap-4 lg:contents'>
            <div className='w-24 shrink-0 lg:w-40'>
              <GameEntryImage centered rom={rom} />
            </div>
            <div className='min-w-0 lg:hidden'>
              <div className='text-xs tracking-wider uppercase opacity-75'>{heading}</div>
              <Link className='block text-xl leading-tight font-bold' to={romPath(rom)}>
                {getRomGoodcodes(rom).rom}
              </Link>
              <div className='text-sm opacity-75'>{when ? `${platformName}, ${when}` : platformName}</div>
            </div>
          </div>

          <div className='flex min-w-0 flex-col gap-3 lg:flex-1'>
            <div className='hidden lg:block'>
              <div className='text-xs tracking-wider uppercase opacity-75'>{heading}</div>
              <Link className='block text-3xl leading-tight font-bold hover:underline' to={romPath(rom)}>
                {getRomGoodcodes(rom).rom}
              </Link>
              <div className='text-sm opacity-75'>
                {when ? t('home.platformPlayed', { platform: platformName, when }) : platformName}
              </div>
            </div>
            {/* Download the game only when it's launched, so opening the library stays quick */}
            <div className='sm:max-w-sm'>
              <GameButtons compact lazy />
            </div>
          </div>

          {inProgressRoms.length > 0 ? <AlsoInProgress layout='panel' roms={inProgressRoms} /> : null}
        </div>
      </section>

      {inProgressRoms.length > 0 ? <AlsoInProgress layout='row' roms={inProgressRoms} /> : null}
    </>
  )
}
