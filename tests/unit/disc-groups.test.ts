import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { parseDisc } from '#@/utils/isomorphic/discs.ts'

// A game on several discs is listed and played as one: its saves, favorites and history follow the disc that stands
// for it, the lowest-numbered one in the library
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-discs-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')
let app: ReturnType<typeof createServer>
let cookie = ''

async function call(url: string, init: RequestInit = {}) {
  const response = await app.request(url, { ...init, headers: { ...init.headers, Cookie: cookie } })
  assert.ok(response.ok, `${url}: ${response.status} ${await response.clone().text()}`)
  return response.json()
}

function upload(name: string, fill: number) {
  const body = new FormData()
  body.append('platform', 'psx')
  body.append('file', new File([new Uint8Array(4096).fill(fill)], name))
  return call('/api/v1/roms', { body, method: 'POST' })
}

await describe('disc names', async () => {
  await it('reads the game and the disc number', () => {
    assert.deepEqual(parseDisc('Chrono Cross (USA, Canada) (Disc 2).chd'), {
      group: 'Chrono Cross (USA, Canada)',
      number: 2,
    })
    assert.deepEqual(parseDisc('Rival Schools - United by Fate (USA) (Disc 2) (Evolution Disc).chd'), {
      group: 'Rival Schools - United by Fate (USA)',
      number: 2,
    })
    assert.equal(parseDisc('Crash Bandicoot (USA).chd'), undefined)
  })
})

await describe('multi-disc games', async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    await initializeDatabase()
    app = createServer({ pages: (c) => c.text('page') })
    const form = new FormData()
    form.append('username', 'player')
    form.append('password', 'disc-groups-1')
    const response = await app.request('/api/v1/auth/register', { body: form, method: 'POST' })
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    await call('/api/v1/preference', {
      body: JSON.stringify({ ui: { platforms: ['psx'] } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  })

  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  await it("keeps a game's saves and favorite together when an earlier disc is added", async () => {
    const disc2 = await upload('Koudelka (USA) (Disc 2).chd', 2)
    const state = new FormData()
    for (const [key, value] of Object.entries({ core: 'pcsx_rearmed', disc: '2', rom: disc2.id, type: 'manual' })) {
      state.append(key, value)
    }
    state.append('state', new Blob(['s']))
    state.append('thumbnail', new Blob(['p']))
    await call('/api/v1/states', { body: state, method: 'POST' })
    await call('/api/v1/favorites', {
      body: JSON.stringify({ romId: disc2.id }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    const disc1 = await upload('Koudelka (USA) (Disc 1).chd', 1)
    await upload('Crash Bandicoot (USA).chd', 3)

    const { roms } = await call('/api/v1/roms/search?query=koudelka')
    assert.deepEqual(
      roms.map(({ discCount, id, isFavorite }: { discCount: number; id: string; isFavorite: number }) => [
        id,
        discCount,
        isFavorite,
      ]),
      [[disc1.id, 2, 1]],
    )
    const crash = await call('/api/v1/roms/search?query=crash')
    assert.equal(crash.roms[0].discCount, 1)
    const states = await call(`/api/v1/roms/${disc1.id}/states?type=manual`)
    assert.equal(states.length, 1)
    assert.equal(states[0].disc, 2)
  })

  await it('finds a game on several discs once in search', async () => {
    const { roms } = await call('/api/v1/roms/search?query=koudelka')
    assert.equal(roms.length, 1)
    assert.equal(roms[0].discCount, 2)
  })
})
