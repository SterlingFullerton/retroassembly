import { getContext } from 'hono/context-storage'
import { getLatestGameSave } from '#@/controllers/game-saves/game-saves.ts'
import { getLaunchRecords } from '#@/controllers/launch-records/get-launch-records.ts'
import { type Disc, getDiscs } from '#@/controllers/roms/get-discs.ts'
import { getLibraryOverview } from '#@/controllers/roms/get-home-picks.ts'
import { getRom } from '#@/controllers/roms/get-rom.ts'
import { getRomsWithStates } from '#@/controllers/roms/get-roms-with-states.ts'
import { getRoms } from '#@/controllers/roms/get-roms.ts'
import { getStates } from '#@/controllers/states/get-states.ts'
import { getLibraryScope } from '#@/utils/server/library-scope.ts'

export async function getHomePageData() {
  const { preference } = getContext().var
  const scope = getLibraryScope()

  const [
    { roms: recentlySavedRoms },
    { roms: newAddedRoms },
    { roms: favoriteRoms },
    { roms: recentlyLaunchedRoms },
    overview,
  ] = await Promise.all([
    // The games with saves, newest first: the first to continue, the next few as "Also in progress"
    getRomsWithStates(scope, { pageSize: 9 }),
    getRoms(scope, { direction: 'desc', orderBy: 'added', pageSize: 20 }),
    getRoms(scope, { favorite: true, pageSize: 20 }),
    getLaunchRecords(scope, { pageSize: 1 }),
    getLibraryOverview(scope),
  ])

  const data: {
    discs: Disc[]
    gameSave?: Awaited<ReturnType<typeof getLatestGameSave>>
    rom: (typeof recentlySavedRoms)[number] | null
    state: Awaited<ReturnType<typeof getStates>>[number] | null
  } = { discs: [], rom: null, state: null }

  const rom = recentlySavedRoms[0] || recentlyLaunchedRoms[0] || newAddedRoms[0]
  // Why this game is at the top, for its label
  let heroReason: 'added' | 'played' | 'saved' = 'added'
  if (recentlySavedRoms[0]) {
    heroReason = 'saved'
  } else if (recentlyLaunchedRoms[0]) {
    heroReason = 'played'
  }
  if (rom) {
    const { core } = preference.emulator.platform[rom.platform]
    const [state] = await getStates(scope, { core, limit: 1, rom: rom.id, type: 'any' })
    data.rom = rom
    if (state) {
      data.state = state
    }
    // A game on several discs is played with all of them
    const fullRom = await getRom(scope, { id: rom.id })
    if (fullRom) {
      data.discs = await getDiscs(scope, fullRom)
    }
    // The game's own save, put back before it boots
    data.gameSave = core ? await getLatestGameSave(scope, { core, rom: rom.id }) : undefined
  }

  return {
    discs: data.discs,
    favoriteRoms,
    gameSave: data.gameSave,
    heroReason,
    inProgressRoms: recentlySavedRoms.filter(({ id }) => id !== data.rom?.id).slice(0, 8),
    newAddedRoms,
    overview,
    recentlySavedRoms,
    rom: data.rom,
    state: data.state,
    title: '',
  }
}
