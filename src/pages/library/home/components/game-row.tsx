import type { CSSProperties } from 'react'
import { getCoverSize } from '#@/constants/cover-sizes.ts'
import { GameEntry, type GameEntryLabel } from '../../components/game-entry/game-entry.tsx'
import { usePreference } from '../../hooks/use-preference.ts'

/**
 * Games in one of Home's rows, as wide as the cover size setting makes them, each with an optional label on its console
 * line, such as how many can play
 */
export function GameRow({ label, roms }: Readonly<{ label?: (rom: any) => GameEntryLabel | undefined; roms: any[] }>) {
  const { preference } = usePreference()
  const { phoneRow, row } = getCoverSize(preference.ui.libraryCoverSize)
  const style = { '--computer-width': `${row}px`, '--phone-width': `${phoneRow}px` } as CSSProperties
  return roms.map((rom) => (
    // Every name takes two lines' room, so a short one doesn't leave its console line higher than its neighbours'
    <div
      className='flex w-(--phone-width) shrink-0 flex-col lg:w-(--computer-width) [&_.game-title]:min-h-[2lh]'
      key={rom.id}
      style={style}
    >
      <GameEntry label={label?.(rom)} rom={rom} />
    </div>
  ))
}
