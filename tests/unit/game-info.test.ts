import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import { platformMap } from '#@/constants/platform.ts'
import { gameInfoPlatforms } from '#@/utils/server/game-info/platforms.ts'
import { gameInfoIndexes, gameInfoTables } from '#@/utils/server/game-info/tables.ts'

// Games are looked up in the game info database built with the app: by the file's MD5, then by its name. A small
// database stands in for the real one
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-game-info-'))
const file = path.join(directory, 'game-info.sqlite')
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = file

const { getCompactName, getGoodcodesBaseCompactName } = await import('#@/utils/server/game-info/names.ts')

const db = new DatabaseSync(file)
db.exec(gameInfoTables)
db.exec(gameInfoIndexes)
function addLibretro(id: string, platform: string, name: string, md5 = '') {
  db.prepare(
    'INSERT INTO libretro_games (id, platform, name, rom_name, md5, compact_name, goodcodes_base_compact_name, developer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, platform, name, `${name}.nes`, md5, getCompactName(name), getGoodcodesBaseCompactName(name), 'HAL')
}
function addLaunchbox(databaseId: number, platform: string, name: string) {
  db.prepare(
    'INSERT INTO launchbox_games (database_id, platform, name, compact_name, goodcodes_base_compact_name, overview, release_date, cooperative) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(databaseId, platform, name, getCompactName(name), getGoodcodesBaseCompactName(name), `About ${name}`, 0, 1)
}
const nes = 'Nintendo - Nintendo Entertainment System'
// libretro lists hacks and bad dumps beside each release, often before it
addLibretro('lolo-b2', nes, 'Adventures of Lolo 3 (USA)[b2]')
addLibretro('lolo-tr', nes, 'Adventures of Lolo 3 (USA)[tr it Clomax Dominion]')
addLibretro('lolo-eu', nes, 'Adventures of Lolo 3 (Europe)')
addLibretro('lolo-us', nes, 'Adventures of Lolo 3 (USA)')
addLibretro('zelda', nes, 'Legend of Zelda, The (USA)', '337bd6f1a1163df31bf2633665589ab0')
addLibretro('ff2-d1', 'Sony - PlayStation', 'Fear Effect 2 - Retro Helix (Europe) (Disc 4)')
addLibretro('ff2-us4', 'Sony - PlayStation', 'Fear Effect 2 - Retro Helix (USA) (Disc 4) (Rev 1)')
addLaunchbox(1, 'Nintendo Entertainment System', 'Adventures of Lolo 3')
addLaunchbox(2, 'Nintendo Entertainment System', 'The Legend of Zelda')
addLaunchbox(3, 'Nintendo DS', 'Castlevania: Order of Ecclesia')
db.close()

const { identifyGames, queryGames } = await import('#@/utils/server/game-info/lookup.ts')

after(async () => {
  await rm(directory, { force: true, recursive: true })
})

await describe('game info', async () => {
  await it('names every console in both databases', () => {
    assert.deepEqual(Object.keys(gameInfoPlatforms).toSorted(), Object.keys(platformMap).toSorted())
    for (const [platform, { libretroName }] of Object.entries(platformMap)) {
      assert.ok(
        (gameInfoPlatforms[platform as keyof typeof gameInfoPlatforms].libretro as readonly string[]).includes(
          libretroName,
        ),
        platform,
      )
    }
  })

  await it("picks libretro's plain release for the file's region, and LaunchBox's game by libretro's name", () => {
    const [info] = identifyGames({ files: [{ name: 'Adventures of Lolo 3 (U) [!].nes' }], platform: 'nes' }) || []
    assert.equal(info?.libretro?.id, 'lolo-us')
    assert.equal(info?.launchbox?.databaseId, 1)
    // As msleuth's server sent it: dates as text, flags as true or false
    assert.equal(info?.launchbox?.releaseDate, '1970-01-01T00:00:00.000Z')
    assert.equal(info?.launchbox?.cooperative, true)
    const [european] = identifyGames({ files: [{ name: 'Adventures of Lolo 3 (E).nes' }], platform: 'nes' }) || []
    assert.equal(european?.libretro?.id, 'lolo-eu')
  })

  await it('finds a game by its MD5 whatever the file is called', () => {
    const [info] =
      identifyGames({ files: [{ md5: '337bd6f1a1163df31bf2633665589ab0', name: 'zelda1.nes' }], platform: 'nes' }) || []
    assert.equal(info?.libretro?.id, 'zelda')
    // "Legend of Zelda, The" is LaunchBox's "The Legend of Zelda"
    assert.equal(info?.launchbox?.name, 'The Legend of Zelda')
  })

  await it('keeps to the disc a file is for', () => {
    const [info] =
      identifyGames({ files: [{ name: 'Fear Effect 2 - Retro Helix (USA) (Disc 4).chd' }], platform: 'psx' }) || []
    assert.equal(info?.libretro?.id, 'ff2-us4')
  })

  await it('looks up DS games in LaunchBox, which msleuth never did', () => {
    const [info] = identifyGames({ files: [{ name: 'Castlevania - Order of Ecclesia.nds' }], platform: 'nds' }) || []
    assert.equal(info?.launchbox?.databaseId, 3)
  })

  await it('finds nothing for a game in neither database, and for consoles it has no names for', () => {
    assert.deepEqual(identifyGames({ files: [{ name: 'Unknown Game (U).nes' }], platform: 'nes' }), [
      { launchbox: null, libretro: null },
    ])
    assert.deepEqual(identifyGames({ files: [{ name: 'a.bin' }], platform: 'nothing' }), [
      { launchbox: null, libretro: null },
    ])
  })

  await it('finds the info stored for games matched before by their IDs', () => {
    const [found, missing] =
      queryGames({
        conditions: [
          { launchboxId: 2, libretroId: 'zelda' },
          { launchboxId: 99, libretroId: 'gone' },
        ],
      }) || []
    assert.equal(found?.launchbox?.name, 'The Legend of Zelda')
    assert.equal(found?.libretro?.name, 'Legend of Zelda, The (USA)')
    assert.deepEqual(missing, {})
  })
})
