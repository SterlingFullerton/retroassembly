import { GameEntry } from '../../components/game-entry/game-entry.tsx'

/** Games in one of Home's rows, each with an optional note under it, such as how many can play */
export function GameRow({ note, roms }: Readonly<{ note?: (rom: any) => string | undefined; roms: any[] }>) {
  return roms.map((rom) => (
    // Notes sit at the bottom so they line up across the row
    <div className='flex w-28 shrink-0 flex-col lg:w-36' key={rom.id}>
      <GameEntry rom={rom} />
      {note?.(rom) ? (
        <div className='mt-auto pt-1 text-center'>
          <span className='rounded-full bg-(--accent-3) px-2 text-xs text-(--accent-11)'>{note(rom)}</span>
        </div>
      ) : null}
    </div>
  ))
}
