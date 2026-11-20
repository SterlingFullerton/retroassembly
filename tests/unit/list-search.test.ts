import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// A game list's search box: the list keeps only the games the quick search finds, best match first or sorted another way
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-list-search-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')
const { getDatabase } = await import('#@/utils/server/drizzle.ts')
const { getRomLetters } = await import('#@/controllers/roms/get-rom-letters.ts')
const { getRoms } = await import('#@/controllers/roms/get-roms.ts')
const { searchRoms } = await import('#@/controllers/roms/search-roms.ts')
const { getListOrder } = await import('#@/constants/roms-order.ts')
type Scope = Parameters<typeof getRoms>[0]

const gameBoy = [
  'Super Mario Land.gb',
  'Dr. Mario.gb',
  'Mario Golf.gb',
  'Mario Tennis.gb',
  'Tetris.gb',
  'Kirby.gb',
  "Mario's Picross.gb",
  'Zelda.gb',
]
const nes = ['Super Mario Bros.nes', 'Mario Bros.nes', 'Metroid.nes']
let scope: Scope

function names(roms: { fileName: string }[]) {
  return roms.map(({ fileName }) => fileName)
}

await describe('searching a game list', async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    await initializeDatabase()
    const app = createServer({ pages: (c) => c.text('page') })
    const form = new FormData()
    form.append('username', 'player')
    form.append('password', 'search-1')
    const response = await app.request('/api/v1/auth/register', { body: form, method: 'POST' })
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const uploads = [...gameBoy.map((name) => ['gb', name]), ...nes.map((name) => ['nes', name])]
    for (const [index, [platform, name]] of uploads.entries()) {
      const body = new FormData()
      body.append('platform', platform)
      body.append('file', new File([new Uint8Array(512).fill(index + 1)], name))
      await app.request('/api/v1/roms', { body, headers: { Cookie: cookie }, method: 'POST' })
    }
    const database = getDatabase().library.$client
    const user = database.prepare('SELECT id FROM users').get() as { id: string }
    for (const name of ['Mario Golf.gb', 'Tetris.gb']) {
      const { id } = database.prepare('SELECT id FROM roms WHERE file_name = ?').get(name) as { id: string }
      await app.request('/api/v1/favorites', {
        body: JSON.stringify({ romId: id }),
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        method: 'POST',
      })
    }
    scope = {
      db: getDatabase().library,
      libraryOwnerId: user.id,
      preference: { ui: { platforms: ['gb', 'nes'] } },
      user: { id: user.id },
    } as unknown as Scope
  })

  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  await it('lists the matches best first, in the quick search order, page by page', async () => {
    const quick = await searchRoms(scope, { pageSize: 100, query: 'mario' })
    const listed: string[] = []
    for (let page = 1; page <= 4; page += 1) {
      const { pagination, roms, search } = await getRoms(scope, {
        orderBy: 'match',
        page,
        pageSize: 3,
        search: 'mario',
      })
      listed.push(...names(roms))
      assert.equal(pagination.total, quick.pagination.total)
      assert.equal(pagination.pages, 3)
      assert.deepEqual(search, { query: 'mario', searched: gameBoy.length + nes.length })
    }
    assert.deepEqual(listed, names(quick.roms))
    assert.equal(listed.length, 7)
  })

  await it('sorts only the matches when another sort is picked', async () => {
    const { pagination, roms } = await getRoms(scope, { orderBy: 'name', search: 'mario' })
    assert.equal(pagination.total, 7)
    assert.deepEqual(
      names(roms),
      names(roms).toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    )
    const { roms: reversed } = await getRoms(scope, { direction: 'desc', orderBy: 'name', search: 'mario' })
    assert.deepEqual(names(reversed), names(roms).toReversed())
  })

  await it('searches one console, or only favorites', async () => {
    const { roms } = await getRoms(scope, { orderBy: 'match', platform: 'nes', search: 'mario' })
    assert.deepEqual(names(roms).toSorted(), ['Mario Bros.nes', 'Super Mario Bros.nes'])
    const favorites = await getRoms(scope, { favorite: true, orderBy: 'match', search: 'mario' })
    assert.deepEqual(names(favorites.roms), ['Mario Golf.gb'])
    assert.equal(favorites.search?.searched, 2)
  })

  await it('finds nothing without failing', async () => {
    const { pagination, roms } = await getRoms(scope, { orderBy: 'match', search: 'castlevania' })
    assert.equal(pagination.total, 0)
    assert.deepEqual(roms, [])
    const byName = await getRoms(scope, { orderBy: 'name', search: 'castlevania' })
    assert.equal(byName.pagination.total, 0)
  })

  await it('lists everything as before without a search', async () => {
    const { pagination, search } = await getRoms(scope, { orderBy: 'match' })
    assert.equal(pagination.total, gameBoy.length + nes.length)
    assert.equal(search, undefined)
  })

  await it('puts the letters where the matches sorted by name are', async () => {
    const { matchIds } = await getRoms(scope, { orderBy: 'name', search: 'mario' })
    const letters = await getRomLetters(scope, { ids: matchIds, pageSize: 3 })
    const has = letters.filter((letter) => letter.has).map(({ letter, page }) => `${letter}${page}`)
    // Dr. Mario; Mario Bros, Mario Golf, Mario Tennis, Mario's Picross; Super Mario Bros, Super Mario Land
    assert.deepEqual(has, ['d1', 'm1', 's2'])
  })

  await it('orders by best match only while searching', () => {
    assert.equal(getListOrder(null, true), 'match')
    assert.equal(getListOrder('match', true), 'match')
    assert.equal(getListOrder('name', true), 'name')
    assert.equal(getListOrder('match', false), 'popular')
    assert.equal(getListOrder(null, false), 'popular')
    assert.equal(getListOrder('nonsense', true), 'popular')
  })
})
