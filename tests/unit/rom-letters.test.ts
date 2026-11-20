import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// A list sorted by name can jump to a letter: each letter goes to the page its first game is on
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-letters-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')
const { getDatabase } = await import('#@/utils/server/drizzle.ts')
const { getRomLetters } = await import('#@/controllers/roms/get-rom-letters.ts')
const { getRoms } = await import('#@/controllers/roms/get-roms.ts')
type Scope = Parameters<typeof getRoms>[0]

const names = [
  '007 Racing.gb',
  'Asteroids.gb',
  'Adventure Island.gb',
  'Bomberman.gb',
  'castlevania.gb',
  'Donkey Kong.gb',
  'Dr. Mario.gb',
  'Final Fantasy Adventure.gb',
  'Frogger.gb',
  'Kirby.gb',
  'Mega Man.gb',
  'Metroid II.gb',
  'Pokemon Red.gb',
  'Tetris.gb',
  'Zelda.gb',
  '[BIOS] Game Boy.gb',
]
const pageSize = 3
let scope: Scope

async function checkLetters(direction: 'asc' | 'desc') {
  // Where each letter's first game really is, read from the list itself
  const firstPage = new Map<string, number>()
  for (let page = 1; page <= Math.ceil(names.length / pageSize); page += 1) {
    const { roms } = await getRoms(scope, { direction, orderBy: 'name', page, pageSize })
    for (const { fileName } of roms) {
      const first = fileName[0].toLowerCase()
      const letter = /[a-z]/u.test(first) ? first : '#'
      if (!firstPage.has(letter)) {
        firstPage.set(letter, page)
      }
    }
  }
  const letters = await getRomLetters(scope, { direction, pageSize })
  for (const { has, letter, page } of letters) {
    assert.equal(has, firstPage.has(letter), `whether ${letter} has games`)
    if (has) {
      assert.equal(page, firstPage.get(letter), `the page ${letter} starts on`)
    }
  }
}

await describe('jumping by letter', async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    await initializeDatabase()
    const app = createServer({ pages: (c) => c.text('page') })
    const form = new FormData()
    form.append('username', 'player')
    form.append('password', 'letters-1')
    const response = await app.request('/api/v1/auth/register', { body: form, method: 'POST' })
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    for (const [index, name] of names.entries()) {
      const body = new FormData()
      body.append('platform', 'gb')
      body.append('file', new File([new Uint8Array(512).fill(index + 1)], name))
      await app.request('/api/v1/roms', { body, headers: { Cookie: cookie }, method: 'POST' })
    }
    const user = getDatabase().library.$client.prepare('SELECT id FROM users').get() as { id: string }
    scope = {
      db: getDatabase().library,
      libraryOwnerId: user.id,
      preference: { ui: { platforms: ['gb'] } },
      user: { id: user.id },
    } as unknown as Scope
  })

  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  await it('lands each letter on the page its first game is on, sorted A to Z', () => checkLetters('asc'))
  await it('lands each letter on the page its first game is on, sorted Z to A', () => checkLetters('desc'))
})
