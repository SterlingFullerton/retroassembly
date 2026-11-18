import { Badge } from '@radix-ui/themes'
import { compact } from 'es-toolkit'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { usePreference } from '../../hooks/use-preference.ts'
import { DistrictIcon } from '../district-icon.tsx'

export function GameTitle({ rom }) {
  const { preference } = usePreference()
  const goodcodes = getRomGoodcodes(rom)

  const { countries, revision, version = {} } = goodcodes.codes
  const districts = new Set(countries?.map(({ code }) => code))

  const revisionText = revision ? `Rev ${revision}` : ''
  const versionText = Object.keys(version)
    .filter((text) => text !== 'stable')
    .join(' ')

  if (!preference.ui.showTitle) {
    return <div className='h-8' />
  }

  if (rom.platform === 'arcade1') {
    return (
      <div className='line-clamp-3 h-16 overflow-hidden text-center text-sm font-semibold'>
        {goodcodes.file.slice(4)}
      </div>
    )
  }

  const badges = compact([revisionText, versionText])

  // Revision and version always go on their own line under the name, which then takes two lines instead of three
  return (
    <div className='flex h-16 flex-col items-center overflow-hidden text-center text-sm font-semibold'>
      <div className={badges.length > 0 ? 'line-clamp-2' : 'line-clamp-3'}>
        {preference.ui.showDistrictOnTitle
          ? [...districts].map((district) => <DistrictIcon district={district} key={district} />)
          : null}
        {goodcodes.rom}
      </div>
      {badges.length > 0 ? (
        <div className='mt-0.5 flex gap-1'>
          {badges.map((text) => (
            <Badge className='capitalize' key={text} size='1'>
              {text}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
