import { client } from '#@/api/client.ts'

// Every save goes through this queue: it's kept in the browser until the server has it, so a save survives a dropped
// connection or the browser closing the tab mid-upload, and is uploaded the next time the library opens. Each save has
// an id made here, so uploading it again can't store it twice

/** A save state: a snapshot of the whole emulator */
export interface QueuedStateSave {
  core: string
  /** The disc in the drive, for a game on several discs */
  disc?: number
  id: string
  rom: string
  savedAt: number
  state: Blob
  thumbnail: Blob
  type: 'auto' | 'manual'
}

/** The game's own save, as the game wrote it: a memory card or a cartridge's battery save */
export interface QueuedGameSave {
  core: string
  file: Blob
  /** The file's extension, as the emulator names it */
  fileType: string
  id: string
  rom: string
  savedAt: number
  type: 'game'
}

export type QueuedSave = QueuedGameSave | QueuedStateSave

// What's given to save(): a save without the id and time the queue gives it
type SaveInput = QueuedSave extends infer T ? (T extends QueuedSave ? Omit<T, 'id' | 'savedAt'> : never) : never

/** Where queued saves are kept: IndexedDB in the browser, memory in tests */
export interface SaveStore {
  delete: (id: string) => Promise<void>
  getAll: () => Promise<QueuedSave[]>
  put: (save: QueuedSave) => Promise<void>
}

/** Sends a save to the server; throws if it isn't stored */
export type SaveUploader = (save: QueuedSave) => Promise<void>

const databaseName = 'retroassembly-pending-saves'
// Version 1 kept one save per game, under the game's id, in "saves"; version 2 keeps every save, under its own id
const storeName = 'queue'
const oldStoreName = 'saves'

// How long the browser's store of saves may take for each thing asked of it. It can wait forever, for one when another
// tab of the library, open from an older version, blocks it from being opened; the save is then uploaded straight away
// instead of waiting for it
const storeTimeoutMs = 3000

/** Rejects if `promise` hasn't settled within `ms` */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function newId() {
  return globalThis.crypto.randomUUID()
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      const queue = database.createObjectStore(storeName, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(oldStoreName)) {
        return
      }
      // Saves left from before are moved over as auto saves
      const old = request.transaction?.objectStore(oldStoreName).getAll()
      old?.addEventListener('success', () => {
        for (const save of old.result as Omit<QueuedSave, 'id' | 'type'>[]) {
          queue.put({ ...save, id: newId(), type: 'auto' })
        }
        database.deleteObjectStore(oldStoreName)
      })
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(new Error(request.error?.message ?? 'IndexedDB request failed')))
    // Another tab has it open at an older version, and the upgrade waits for that tab to close
    request.addEventListener('blocked', () => reject(new Error('IndexedDB is blocked by another tab')))
  })
}

async function runInStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(storeName, mode).objectStore(storeName))
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => reject(new Error(request.error?.message ?? 'IndexedDB request failed')))
    })
  } finally {
    database.close()
  }
}

export const indexedDBSaveStore: SaveStore = {
  async delete(id) {
    await runInStore('readwrite', (store) => store.delete(id))
  },
  getAll: () => runInStore<QueuedSave[]>('readonly', (store) => store.getAll()),
  async put(save) {
    await runInStore('readwrite', (store) => store.put(save))
  },
}

async function postSave(save: QueuedSave) {
  if (save.type === 'game') {
    const { core, file, fileType, id, rom } = save
    // @ts-expect-error the hono client accepts blobs as form values, though its types only list files
    return await client.game_saves.$post({ form: { clientId: id, core, file, fileType, rom } })
  }
  const { core, disc, id, rom, state, thumbnail, type } = save
  const form = { clientId: id, core, rom, state, thumbnail, type, ...(disc ? { disc: String(disc) } : {}) }
  // @ts-expect-error the hono client accepts blobs as form values, though its types only list files
  return await client.states.$post({ form })
}

export async function uploadSaveToServer(save: QueuedSave) {
  const response = await postSave(save)
  if (!response.ok) {
    throw new Error(`Failed to upload the save: ${response.status}`)
  }
}

export function createSaveQueue(
  givenStore: SaveStore = indexedDBSaveStore,
  upload: SaveUploader = uploadSaveToServer,
  { timeoutMs = storeTimeoutMs } = {},
) {
  // Each thing asked of the store gives up after a while, rather than holding the save up
  const store: SaveStore = {
    delete: (id) => withTimeout(givenStore.delete(id), timeoutMs, 'The save store took too long'),
    getAll: () => withTimeout(givenStore.getAll(), timeoutMs, 'The save store took too long'),
    put: (save) => withTimeout(givenStore.put(save), timeoutMs, 'The save store took too long'),
  }

  async function remove(save: QueuedSave) {
    try {
      await store.delete(save.id)
    } catch {}
  }

  /**
   * Queues a save and uploads it. Only the newest auto save of a game, and the newest of its own saves, are worth
   * keeping, so older ones waiting to upload are dropped; manual saves are all kept. If the upload fails, the save stays
   * queued and the error is thrown.
   */
  async function save(input: SaveInput) {
    const queued = { ...input, id: newId(), savedAt: Date.now() } as QueuedSave
    // Kept first, before anything else, so a tab closed right after a save on hide still has it
    try {
      await store.put(queued)
    } catch {}
    if (queued.type !== 'manual') {
      try {
        const waiting = await store.getAll()
        const older = waiting.filter(
          ({ core, id, rom, type }) =>
            type === queued.type && rom === queued.rom && (type === 'auto' || core === queued.core) && id !== queued.id,
        )
        await Promise.all(older.map((old) => remove(old)))
      } catch {}
    }
    await upload(queued)
    await remove(queued)
    return queued
  }

  /** Uploads every save still waiting, oldest first. Returns how many it uploaded */
  async function flush() {
    let waiting: QueuedSave[]
    try {
      waiting = await store.getAll()
    } catch {
      return 0
    }
    let uploaded = 0
    for (const queued of waiting.toSorted((a, b) => a.savedAt - b.savedAt)) {
      try {
        await upload(queued)
        await remove(queued)
        uploaded += 1
      } catch {}
    }
    return uploaded
  }

  return { flush, save }
}

export const saveQueue = createSaveQueue()
