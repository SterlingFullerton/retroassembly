import { getContext } from 'hono/context-storage'
import { HTTPException } from 'hono/http-exception'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { getLatestGameSave } from '#@/controllers/game-saves/game-saves.ts'
import { getDiscs } from '#@/controllers/roms/get-discs.ts'
import { getRom } from '#@/controllers/roms/get-rom.ts'
import { getStates } from '#@/controllers/states/get-states.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { getLibraryScope } from '#@/utils/server/library-scope.ts'
import { addCoverCandidates } from '#@/utils/server/rom-cover-candidates.ts'

function isPlatformName(name: string): name is PlatformName {
  return name in platformMap
}

export async function getRomPageData({ fileName, platform }: { fileName: string; platform: string }) {
  if (!isPlatformName(platform)) {
    throw new HTTPException(404, { message: 'Not Found' })
  }
  const rom = await getRom(getLibraryScope(), { fileName, platform })
  if (!rom) {
    // The library's SNES games were once filed as Super Famicom; a link from then leads to the same game under SNES
    if (platform === 'sfc') {
      return { redirect: { fileName, platform: 'snes' } }
    }
    throw new HTTPException(404, { message: 'Not Found' })
  }
  // A game on several discs has one page, its first disc's; another disc's address leads there
  const discs = await getDiscs(getLibraryScope(), rom)
  if (discs.length > 0 && discs[0].id !== rom.id) {
    return { redirect: { fileName: discs[0].fileName, platform } }
  }
  const { preference } = getContext().var
  const core = preference.emulator.platform[rom.platform]?.core
  const [states, gameSave] = await Promise.all([
    // Every snapshot this game's emulator can load, newest first: the newest is the one Continue uses
    getStates(getLibraryScope(), { core, rom: rom.id, type: 'any' }),
    // The game's own save, put back before it boots
    core ? getLatestGameSave(getLibraryScope(), { core, rom: rom.id }) : undefined,
  ])
  // Which of its pictures the server has, including libretro's box art matched by title
  await addCoverCandidates([rom])
  return { discs, gameSave, rom, state: states[0], states, title: getRomGoodcodes(rom).rom }
}
