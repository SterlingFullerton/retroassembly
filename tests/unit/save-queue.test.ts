import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSaveQueue, type QueuedSave, type SaveStore } from '#@/emulator/save-queue.ts'

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
})
