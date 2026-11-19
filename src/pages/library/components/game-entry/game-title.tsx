import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { usePreference } from '../../hooks/use-preference.ts'
import { DistrictIcon } from '../district-icon.tsx'

/** A game entry's name, left-aligned, up to two lines; its revision and version are labels on the console line */
export function GameTitle({ rom }) {
  const { preference } = usePreference()
  const goodcodes = getRomGoodcodes(rom)

  if (!preference.ui.showTitle) {
    return null
  }

  const districts = new Set(goodcodes.codes.countries?.map(({ code }) => code))

  return (
    <div className='game-title line-clamp-2 text-sm leading-snug font-semibold'>
      {preference.ui.showDistrictOnTitle
        ? [...districts].map((district) => <DistrictIcon district={district} key={district} />)
        : null}
      {goodcodes.rom}
    </div>
  )
}
