import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// Who may read and change what, across three accounts: the admin, an account sharing the admin's library, and an
// account with a library of its own. Library data (games, box art) belongs to the library's owner and can only be
// changed by them; personal data (saves, favorites, play history) belongs to whoever is signed in
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-permissions-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// Game info lookups fail at once instead of waiting on the internet
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')

type Account = 'admin' | 'other' | 'sharer'
type As = Account | 'nobody'
let app: ReturnType<typeof createServer>
const cookies: Record<Account, string> = { admin: '', other: '', sharer: '' }
const ids = { adminRom: '', adminState: '', other: '', otherRom: '', sharer: '' }

function request(as: As, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (as !== 'nobody') {
    headers.set('Cookie', cookies[as])
  }
  return app.request(url, { ...init, headers })
}

function form(fields: Record<string, Blob | string>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value)
  }
  return body
}

async function json(as: As, url: string, init: RequestInit = {}) {
  const response = await request(as, url, init)
  assert.equal(response.status, 200, `${init.method ?? 'GET'} ${url} as ${as}: ${await response.clone().text()}`)
  return response.json()
}

async function signUp(account: Account) {
  const body = form({ password: `${account}-password`, username: account })
  const response = await app.request('/api/v1/auth/register', { body, method: 'POST' })
  assert.equal(response.status, 200)
  cookies[account] = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const { user } = await response.json()
  return user.id as string
}

async function status(as: As, url: string, init: RequestInit = {}) {
  const response = await request(as, url, init)
  return response.status
}

function favorite(as: Account, romId: string) {
  return status(as, '/api/v1/favorites', {
    body: JSON.stringify({ romId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

function launch(as: Account, rom: string) {
  return status(as, '/api/v1/launch_records', { body: form({ core: 'fceumm', rom }), method: 'POST' })
}

function saveState(as: Account, rom: string) {
  return status(as, '/api/v1/states', {
    body: form({ core: 'fceumm', rom, state: new Blob(['s']), thumbnail: new Blob(['p']), type: 'manual' }),
    method: 'POST',
  })
}

// A save the browser gave the id save-1
function repeatedSave() {
  return form({
    clientId: 'save-1',
    core: 'fceumm',
    rom: ids.adminRom,
    state: new Blob(['s']),
    thumbnail: new Blob(['p']),
    type: 'auto',
  })
}

function uploadRom(as: Account, name: string) {
  const file = new File([new Uint8Array(4096).fill(name.length)], name)
  return request(as, '/api/v1/roms', { body: form({ file, platform: 'nes' }), method: 'POST' })
}

await describe('permissions', async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    await initializeDatabase()
    app = createServer({ pages: (c) => c.text('page') })

    await signUp('admin')
    ids.sharer = await signUp('sharer')
    ids.other = await signUp('other')
    await json('admin', `/api/v1/users/${ids.sharer}`, { body: form({ libraryMode: '1' }), method: 'PATCH' })
    for (const account of ['admin', 'sharer', 'other'] as const) {
      await json(account, '/api/v1/preference', {
        body: JSON.stringify({ ui: { platforms: ['nes'] } }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    }

    const adminRom = await uploadRom('admin', 'Admin Game.nes')
    const adminRomJson = await adminRom.json()
    ids.adminRom = adminRomJson.id
    const otherRom = await uploadRom('other', 'Other Game.nes')
    const otherRomJson = await otherRom.json()
    ids.otherRom = otherRomJson.id
    const state = form({
      core: 'fceumm',
      rom: ids.adminRom,
      state: new Blob(['state']),
      thumbnail: new Blob(['png']),
      type: 'manual',
    })
    const adminState = await json('admin', '/api/v1/states', { body: state, method: 'POST' })
    ids.adminState = adminState.id
  })

  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  // [description, request, expected status for admin, sharer, other, nobody]
  const reads: [string, () => string, Record<As, number>][] = [
    ['library games', () => '/api/v1/roms', { admin: 200, nobody: 401, other: 200, sharer: 200 }],
    [
      "the admin's game file",
      () => `/api/v1/roms/${ids.adminRom}/content`,
      { admin: 200, nobody: 401, other: 404, sharer: 200 },
    ],
    [
      "the admin's game's saves",
      () => `/api/v1/roms/${ids.adminRom}/states`,
      { admin: 200, nobody: 401, other: 404, sharer: 200 },
    ],
    [
      'saves for a game',
      () => `/api/v1/states?rom=${ids.adminRom}&type=manual`,
      { admin: 200, nobody: 401, other: 404, sharer: 200 },
    ],
    ['play history', () => '/api/v1/launch_records', { admin: 200, nobody: 401, other: 200, sharer: 200 }],
    ['settings', () => '/api/v1/preference', { admin: 200, nobody: 401, other: 200, sharer: 200 }],
    ['the account list', () => '/api/v1/users', { admin: 200, nobody: 401, other: 403, sharer: 403 }],
    [
      'a stored file',
      () => '/api/v1/files/roms%2Fnes%2Fmissing.nes',
      { admin: 404, nobody: 401, other: 404, sharer: 404 },
    ],
  ]

  for (const [description, url, expected] of reads) {
    for (const as of ['admin', 'sharer', 'other', 'nobody'] as const) {
      await it(`reading ${description} as ${as} is ${expected[as]}`, async () => {
        const response = await request(as, url())
        assert.equal(response.status, expected[as], await response.text())
      })
    }
  }

  await it('each account sees only its own saves', async () => {
    const adminStates = await json('admin', `/api/v1/states?rom=${ids.adminRom}&type=manual`)
    assert.equal(adminStates.length, 1)
    const sharerStates = await json('sharer', `/api/v1/states?rom=${ids.adminRom}&type=manual`)
    assert.equal(sharerStates.length, 0)
  })

  await it('a shared library can be read but not changed', async () => {
    const upload = await uploadRom('sharer', 'Sharer Game.nes')
    assert.equal(upload.status, 403)
    const edit = await request('sharer', `/api/v1/roms/${ids.adminRom}`, {
      body: form({ gameName: 'Renamed' }),
      method: 'PATCH',
    })
    assert.equal(edit.status, 403)
    const boxart = await request('sharer', `/api/v1/roms/${ids.adminRom}/boxart`, {
      body: form({ file: new File(['png'], 'cover.png') }),
      method: 'POST',
    })
    assert.equal(boxart.status, 403)
    assert.equal(await status('sharer', `/api/v1/roms/${ids.adminRom}/boxart`, { method: 'DELETE' }), 403)
    assert.equal(await status('sharer', `/api/v1/roms/${ids.adminRom}`, { method: 'DELETE' }), 403)
  })

  await it("another library's games can't be changed and look like they don't exist", async () => {
    const edit = await request('other', `/api/v1/roms/${ids.adminRom}`, {
      body: form({ gameName: 'Renamed' }),
      method: 'PATCH',
    })
    assert.equal(edit.status, 404)
    const boxart = await request('other', `/api/v1/roms/${ids.adminRom}/boxart`, {
      body: form({ file: new File(['png'], 'cover.png') }),
      method: 'POST',
    })
    assert.equal(boxart.status, 404)
    assert.equal(await status('other', `/api/v1/roms/${ids.adminRom}`, { method: 'DELETE' }), 404)
    // Deleting several at once skips the ones that aren't yours
    assert.equal(await status('other', `/api/v1/roms?ids=${ids.adminRom}`, { method: 'DELETE' }), 200)
    assert.equal(await status('admin', `/api/v1/roms/${ids.adminRom}/content`), 200)
  })

  await it('favorites and play history are only for games in your library', async () => {
    assert.equal(await favorite('sharer', ids.adminRom), 200)
    assert.equal(await favorite('other', ids.adminRom), 404)
    assert.equal(await favorite('other', 'missing'), 404)

    assert.equal(await launch('sharer', ids.adminRom), 200)
    assert.equal(await launch('other', ids.adminRom), 404)
    assert.equal(await launch('other', 'missing'), 404)
  })

  await it('saves can be made on a shared game, and only deleted by whoever made them', async () => {
    assert.equal(await saveState('sharer', ids.adminRom), 200)
    assert.equal(await saveState('other', ids.adminRom), 404)
    assert.equal(await status('other', `/api/v1/states/${ids.adminState}`, { method: 'DELETE' }), 404)
    assert.equal(await status('sharer', `/api/v1/states/${ids.adminState}`, { method: 'DELETE' }), 404)
    assert.equal(await status('admin', `/api/v1/states/${ids.adminState}`, { method: 'DELETE' }), 200)
  })

  await it('stores a save sent again with the same id only once, per account', async () => {
    const first = await json('admin', '/api/v1/states', { body: repeatedSave(), method: 'POST' })
    const again = await json('admin', '/api/v1/states', { body: repeatedSave(), method: 'POST' })
    assert.equal(again.id, first.id)
    const autos = await json('admin', `/api/v1/states?rom=${ids.adminRom}&type=auto`)
    assert.equal(autos.filter(({ id }: { id: string }) => id === first.id).length, 1)
    assert.equal(autos.length, 1)
    // Another account's save with the same id is its own
    const sharers = await json('sharer', '/api/v1/states', { body: repeatedSave(), method: 'POST' })
    assert.notEqual(sharers.id, first.id)
  })

  await it('only the admin manages accounts', async () => {
    const shareLibrary = { body: form({ libraryMode: '1' }), method: 'PATCH' }
    assert.equal(await status('sharer', `/api/v1/users/${ids.other}`, shareLibrary), 403)
    assert.equal(await status('other', `/api/v1/users/${ids.other}`, shareLibrary), 403)
    assert.equal(await status('sharer', `/api/v1/users/${ids.other}`, { method: 'DELETE' }), 403)
  })

  await it('the owner can change their own games', async () => {
    const edit = await request('admin', `/api/v1/roms/${ids.adminRom}`, {
      body: form({ gameName: 'Renamed' }),
      method: 'PATCH',
    })
    assert.equal(edit.status, 200)
    const edited = await edit.json()
    assert.equal(edited.gameName, 'Renamed')
    assert.equal(await status('other', `/api/v1/roms/${ids.otherRom}`, { method: 'DELETE' }), 200)
  })
})
