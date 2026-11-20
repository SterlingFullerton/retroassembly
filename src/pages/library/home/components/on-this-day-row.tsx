import { DateTime } from 'luxon'
import { useTranslation } from 'react-i18next'
import { generatePath, Link } from 'react-router'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { useRomCover } from '#@/pages/library/hooks/use-rom-cover.ts'
import { routes } from '#@/pages/routes.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { HomeRow } from './home-row.tsx'
import { useOnThisDayPicks } from './use-home-picks.ts'

function DayCard({ rom, year }: Readonly<{ rom: any; year: number }>) {
  const { i18n, t } = useTranslation()
  const { data: cover } = useRomCover(rom)
  // Release dates are kept as midnight UTC on the day
  const released = DateTime.fromJSDate(new Date(rom.gameReleaseDate), { zone: 'utc' })
  const years = year - released.year
  return (
    <Link
      className='flex w-72 shrink-0 items-center gap-3 rounded-lg border border-(--gray-5) p-2.5 hover:border-(--accent-7) lg:w-80'
      to={generatePath(routes.libraryPlatformRom, { fileName: rom.fileName, platform: rom.platform })}
    >
      {cover?.src ? (
        <img alt='' className='size-16 shrink-0 rounded-lg object-cover' loading='lazy' src={cover.src} />
      ) : (
        <span className='size-16 shrink-0 rounded-lg bg-(--gray-4)' />
      )}
      <div className='min-w-0 text-sm'>
        <div className='font-semibold text-(--accent-11)'>{t('home.yearsAgoToday', { count: years })}</div>
        <div className='truncate font-semibold'>{getRomGoodcodes(rom).rom}</div>
        <div className='truncate text-xs text-(--gray-11)'>
          {t(platformMap[rom.platform as PlatformName].displayNameI18nKey)},{' '}
          {released.setLocale(i18n.language).toLocaleString(DateTime.DATE_MED)}
        </div>
      </div>
    </Link>
  )
}

/** Games first released on today's date, in earlier years; left out on days with none */
export function OnThisDayRow() {
  const { i18n, t } = useTranslation()
  const { data, date, year } = useOnThisDayPicks()
  const dateParts = date.split('-')
  const games = (data ?? []).filter(
    (rom) => rom.gameReleaseDate && new Date(rom.gameReleaseDate).getUTCFullYear() < year,
  )
  if (games.length === 0) {
    return null
  }
  const today = DateTime.fromObject({ day: Number(dateParts[1]), month: Number(dateParts[0]) })
    .setLocale(i18n.language)
    .toLocaleString({ day: 'numeric', month: 'long' })
  return (
    <HomeRow note={t('home.onThisDayNote', { date: today })} title={t('home.onThisDay')}>
      {games.map((rom) => (
        <DayCard key={rom.id} rom={rom} year={year} />
      ))}
    </HomeRow>
  )
}
