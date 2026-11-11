import { client } from '#@/api/client.ts'

// Saves made when the page is hidden are kept in the browser until the server has them, so they survive the browser
// closing the tab before the upload finishes. They're uploaded as ordinary auto states.

interface PendingSave {
  core: string
  rom: string
  savedAt: number
  state: Blob
  thumbnail: Blob
}

const databaseName = 'retroassembly-pending-saves'
const storeName = 'saves'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(storeName, { keyPath: 'rom' })
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(new Error(request.error?.message ?? 'IndexedDB request failed')))
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

// Only the newest save per game is kept: an older one waiting to upload is superseded by it
export async function putPendingSave(save: PendingSave) {
  await runInStore('readwrite', (store) => store.put(save))
}

async function deletePendingSave(save: PendingSave) {
  const current = await runInStore<PendingSave | undefined>('readonly', (store) => store.get(save.rom))
  if (current?.savedAt === save.savedAt) {
    await runInStore('readwrite', (store) => store.delete(save.rom))
  }
}

export async function uploadPendingSave(save: PendingSave) {
  const { core, rom, state, thumbnail } = save
  // @ts-expect-error the hono client accepts blobs as form values, though its types only list files
  const response = await client.states.$post({ form: { core, rom, state, thumbnail, type: 'auto' } })
  if (!response.ok) {
    throw new Error(`Failed to upload the save: ${response.status}`)
  }
  await deletePendingSave(save)
}

// Uploads any saves left behind, for example when the browser closed the tab mid-upload. Returns how many it uploaded.
export async function uploadPendingSaves() {
  let saves: PendingSave[]
  try {
    saves = await runInStore<PendingSave[]>('readonly', (store) => store.getAll())
  } catch {
    return 0
  }
  let uploaded = 0
  for (const save of saves) {
    try {
      await uploadPendingSave(save)
      uploaded += 1
    } catch {}
  }
  return uploaded
}

export type { PendingSave }
