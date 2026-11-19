import { GameEntry, type GameEntryLabel } from '../../components/game-entry/game-entry.tsx'

/** Games in one of Home's rows, each with an optional label on its console line, such as how many can play */
export function GameRow({ label, roms }: Readonly<{ label?: (rom: any) => GameEntryLabel | undefined; roms: any[] }>) {
  return roms.map((rom) => (
    <div className='flex w-28 shrink-0 flex-col lg:w-36' key={rom.id}>
      <GameEntry label={label?.(rom)} rom={rom} />
    </div>
  ))
}
