import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// A game's own saves (memory cards, battery saves) are kept as versions per player, game and emulator
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-game-saves-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')
const { getDatabase } = await import('#@/utils/server/drizzle.ts')
let app: ReturnType<typeof createServer>
const cookies: Record<string, string> = {}
let romId = ''

async function signUp(name: string) {
  const form = new FormData()
  form.append('username', name)
  form.append('password', `${name}-password`)
  const response = await app.request('/api/v1/auth/register', { body: form, method: 'POST' })
  cookies[name] = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

async function call(as: string, url: string, init: RequestInit = {}) {
  return await app.request(url, { ...init, headers: { ...init.headers, Cookie: cookies[as] } })
}

async function uploadSave(as: string, content: string, clientId?: string) {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    core: 'mgba',
    fileType: 'srm',
    rom: romId,
    ...(clientId ? { clientId } : {}),
  })) {
    form.append(key, value)
  }
  form.append('file', new Blob([content]))
  const response = await call(as, '/api/v1/game_saves', { body: form, method: 'POST' })
  return { body: response.ok ? await response.json() : undefined, status: response.status }
}

async function listSaves(as: string) {
  const response = await call(as, `/api/v1/game_saves?core=mgba&rom=${romId}`)
  return (await response.json()) as { fileId: string; id: string }[]
}

async function readSave(as: string, fileId: string) {
  const response = await call(as, `/api/v1/files/${encodeURIComponent(fileId)}`)
  return await response.text()
}

function versions(user: string) {
  return getDatabase()
    .library.$client.prepare(
      'SELECT count(*) AS count FROM game_saves WHERE status = 1 AND user_id = (SELECT id FROM users WHERE username = ?)',
    )
    .get(user) as { count: number }
}

await describe('in-game saves', async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    await initializeDatabase()
    app = createServer({ pages: (c) => c.text('page') })
    await signUp('admin')
    await signUp('sharer')
    const id = getDatabase().library.$client.prepare('SELECT id FROM users WHERE username = ?').get('sharer') as {
      id: string
    }
    const share = new FormData()
    share.append('libraryMode', '1')
    await call('admin', `/api/v1/users/${id.id}`, { body: share, method: 'PATCH' })
    const upload = new FormData()
    upload.append('platform', 'gb')
    upload.append('file', new File([new Uint8Array(4096).fill(5)], 'Game (USA).gb'))
    const rom = await call('admin', '/api/v1/roms', { body: upload, method: 'POST' })
    romId = (await rom.json()).id
  })

  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  await it('keeps a new version only when the save changed', async () => {
    const first = await uploadSave('admin', 'save-1')
    const same = await uploadSave('admin', 'save-1')
    assert.equal(same.body.id, first.body.id)
    const changed = await uploadSave('admin', 'save-2')
    assert.notEqual(changed.body.id, first.body.id)
    assert.equal(versions('admin').count, 2)
  })

  await it('stores an upload sent again under the same id once', async () => {
    const once = await uploadSave('admin', 'save-3', 'upload-1')
    const again = await uploadSave('admin', 'save-3', 'upload-1')
    assert.equal(again.body.id, once.body.id)
    assert.equal(versions('admin').count, 3)
  })

  await it('keeps the newest 10 versions', async () => {
    for (let index = 4; index <= 15; index += 1) {
      await uploadSave('admin', `save-${index}`)
    }
    assert.equal(versions('admin').count, 10)
  })

  await it("keeps each player's own saves, and only they can read them", async () => {
    const sharers = await uploadSave('sharer', 'sharer-save')
    assert.equal(sharers.status, 200)
    assert.equal(versions('sharer').count, 1)
    const own = await call('sharer', `/api/v1/files/${encodeURIComponent(sharers.body.fileId)}`)
    assert.equal(own.status, 200)
    assert.equal(await own.text(), 'sharer-save')
    const others = await call('admin', `/api/v1/files/${encodeURIComponent(sharers.body.fileId)}`)
    assert.equal(others.status, 404)
  })

  await it('lists versions newest first, and restoring one copies it to the top', async () => {
    const list = await listSaves('admin')
    assert.equal(list.length, 10)
    const [newest, older] = list
    assert.equal(await readSave('admin', newest.fileId), 'save-15')

    const restored = await call('admin', `/api/v1/game_saves/${older.id}/restore`, { method: 'POST' })
    assert.equal(restored.status, 200)
    const after = await listSaves('admin')
    assert.equal(await readSave('admin', after[0].fileId), 'save-14')
    // The version that was in use is still there, just below
    assert.equal(after[1].id, newest.id)
    assert.equal(after.length, 10)

    // Restoring the one in use changes nothing
    const again = await call('admin', `/api/v1/game_saves/${after[0].id}/restore`, { method: 'POST' })
    const kept = (await again.json()) as { id: string }
    assert.equal(kept.id, after[0].id)
  })

  await it("doesn't restore someone else's save", async () => {
    const [sharers] = await listSaves('sharer')
    const response = await call('admin', `/api/v1/game_saves/${sharers.id}/restore`, { method: 'POST' })
    assert.equal(response.status, 404)
  })
})
