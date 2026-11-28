import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSaveQueue, newId, type QueuedSave, SaveUploadError, type SaveStore } from '#@/emulator/save-queue.ts'

// The browser's queue of saves, with memory standing in for IndexedDB and a recorder for the server
function memoryStore() {
  const saves = new Map<string, QueuedSave>()
  const store: SaveStore = {
    delete(id) {
      saves.delete(id)
      return Promise.resolve()
    },
    getAll: () => Promise.resolve([...saves.values()]),
    put(save) {
      saves.set(save.id, save)
      return Promise.resolve()
    },
  }
  return { saves, store }
}

function recorder({ failing = false } = {}) {
  const uploaded: QueuedSave[] = []
  const server = {
    failing,
    upload(save: QueuedSave) {
      if (server.failing) {
        return Promise.reject(new Error('offline'))
      }
      uploaded.push(save)
      return Promise.resolve()
    },
    uploaded,
  }
  return server
}

const blob = new Blob(['x'])
function input(rom: string, type: 'auto' | 'manual') {
  return { core: 'fceumm', rom, state: blob, thumbnail: blob, type }
}

function gameSave(rom: string, core: string, content: string) {
  return { core, file: new Blob([content]), fileType: 'srm', rom, type: 'game' } as const
}

await describe('save queue', async () => {
  await it('uploads a save under an id of its own and lets it go', async () => {
    const { saves, store } = memoryStore()
    const server = recorder()
    const queue = createSaveQueue(store, server.upload)
    const saved = await queue.save(input('rom-1', 'manual'))
    assert.ok(saved.id)
    assert.equal(server.uploaded[0].id, saved.id)
    assert.equal(saves.size, 0)
  })

  await it("keeps a save the server didn't get, and uploads it later under the same id", async () => {
    const { saves, store } = memoryStore()
    const server = recorder({ failing: true })
    const queue = createSaveQueue(store, server.upload)
    await assert.rejects(queue.save(input('rom-1', 'manual')))
    assert.equal(saves.size, 1)
    const [kept] = saves.values()

    server.failing = false
    assert.equal(await queue.flush(), 1)
    assert.equal(server.uploaded[0].id, kept.id)
    assert.equal(saves.size, 0)
  })

  await it("keeps only a game's newest auto save waiting, and every manual one", async () => {
    const { saves, store } = memoryStore()
    const server = recorder({ failing: true })
    const queue = createSaveQueue(store, server.upload)
    await assert.rejects(queue.save(input('rom-1', 'manual')))
    await assert.rejects(queue.save(input('rom-1', 'auto')))
    await assert.rejects(queue.save(input('rom-2', 'auto')))
    await assert.rejects(queue.save(input('rom-1', 'manual')))
    await assert.rejects(queue.save(input('rom-1', 'auto')))
    const waiting = [...saves.values()]
    assert.equal(waiting.filter(({ type }) => type === 'manual').length, 2)
    assert.equal(waiting.filter(({ rom, type }) => type === 'auto' && rom === 'rom-1').length, 1)
    assert.equal(waiting.filter(({ rom }) => rom === 'rom-2').length, 1)
  })

  await it("keeps only a game's newest own save waiting for each emulator, apart from its save states", async () => {
    const { saves, store } = memoryStore()
    const server = recorder({ failing: true })
    const queue = createSaveQueue(store, server.upload)
    await assert.rejects(queue.save(input('rom-1', 'auto')))
    await assert.rejects(queue.save(gameSave('rom-1', 'mgba', 'a')))
    await assert.rejects(queue.save(gameSave('rom-1', 'gambatte', 'b')))
    await assert.rejects(queue.save(gameSave('rom-2', 'mgba', 'c')))
    await assert.rejects(queue.save(gameSave('rom-1', 'mgba', 'd')))
    const waiting = [...saves.values()]
    assert.equal(waiting.filter(({ type }) => type === 'auto').length, 1)
    const games = waiting.filter((save) => save.type === 'game')
    assert.equal(games.length, 3)
    const newest = games.find(({ core, rom }) => core === 'mgba' && rom === 'rom-1')
    assert.equal(newest?.type === 'game' && (await newest.file.text()), 'd')

    server.failing = false
    assert.equal(await queue.flush(), 4)
    assert.equal(saves.size, 0)
  })

  await it('uploads the saves left waiting, oldest first', async () => {
    const { saves, store } = memoryStore()
    const now = Date.now()
    await store.put({ ...input('rom-1', 'manual'), id: 'b', savedAt: now })
    await store.put({ ...input('rom-1', 'manual'), id: 'a', savedAt: now - 1000 })
    const server = recorder()
    const queue = createSaveQueue(store, server.upload)
    assert.equal(await queue.flush(), 2)
    assert.deepEqual(
      server.uploaded.map(({ id }) => id),
      ['a', 'b'],
    )
    assert.equal(saves.size, 0)
  })

  await it('uploads a save only into the account it was made in', async () => {
    const { saves, store } = memoryStore()
    const server = recorder({ failing: true })
    const queue = createSaveQueue(store, server.upload)
    queue.setUser('player-a')
    await assert.rejects(queue.save(input('rom-1', 'auto')))
    // Another account signs in on the same browser: the first one's save stays, and its own doesn't replace it
    queue.setUser('player-b')
    await assert.rejects(queue.save(input('rom-1', 'auto')))
    assert.equal(saves.size, 2)

    server.failing = false
    assert.equal(await queue.flush(), 1)
    assert.equal(server.uploaded[0].user, 'player-b')
    queue.setUser('player-a')
    assert.equal(await queue.flush(), 1)
    assert.equal(server.uploaded[1].user, 'player-a')
    assert.equal(saves.size, 0)
  })

  await it('uploads a save from before saves had an account into whoever signs in', async () => {
    const { saves, store } = memoryStore()
    await store.put({ ...input('rom-1', 'manual'), id: 'a', savedAt: Date.now() })
    const queue = createSaveQueue(store, recorder().upload)
    queue.setUser('player-a')
    assert.equal(await queue.flush(), 1)
    assert.equal(saves.size, 0)
  })

  await it('lets go of a save for a game the server no longer has', async () => {
    const { saves, store } = memoryStore()
    let status = 503
    const queue = createSaveQueue(store, () => Promise.reject(new SaveUploadError(status)))
    await assert.rejects(queue.save(input('rom-1', 'manual')))
    assert.equal(await queue.flush(), 0)
    assert.equal(saves.size, 1)
    status = 404
    assert.equal(await queue.flush(), 0)
    assert.equal(saves.size, 0)
  })

  await it("uploads a save straight away when the browser's store never answers", async () => {
    // A promise nothing ever settles: its resolve is kept and never called
    let unused: unknown
    const never = new Promise<never>((resolve) => {
      unused = resolve
    })
    assert.ok(unused)
    const stuck: SaveStore = { delete: () => never, getAll: () => never, put: () => never }
    const server = recorder()
    const queue = createSaveQueue(stuck, server.upload, { timeoutMs: 20 })
    const saved = await queue.save(input('rom-1', 'auto'))
    assert.equal(server.uploaded[0].id, saved.id)
    assert.equal(await queue.flush(), 0)
  })

  await it('makes ids on a page opened over plain http, where randomUUID is missing', () => {
    const { randomUUID } = globalThis.crypto
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
    try {
      const ids = new Set(Array.from({ length: 100 }, () => newId()))
      assert.equal(ids.size, 100)
      for (const id of ids) {
        assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u)
      }
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID })
    }
  })
})
