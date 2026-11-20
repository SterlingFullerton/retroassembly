import { attemptAsync, sumBy } from 'es-toolkit'
import {
  dataOffset,
  type ReadMessage,
  readState,
  type StoreMessage,
  type WorkerReply,
} from './game-storage-protocol.ts'

// Games kept in the browser's storage, on the device's disk, instead of in the page's memory: the emulator reads the
// part of the disc it needs as it plays. A cache: the NAS keeps the real copy, and the browser may clear it any time

/** The most the stored games may take together; the least recently played go to make room */
export const storageLimit = 4 * 1000 ** 3
const indexKey = 'retroassembly:stored-games'
// The most read at once through shared memory; larger reads take several turns
const readChunk = 4 * 1024 * 1024

export interface StoredGame {
  /** The NAS's tag for the version stored, to tell when it's changed */
  etag?: string
  /** The game's file name and console, to name it and link to it. Games stored before these were kept have neither */
  fileName?: string
  lastPlayed: number
  platform?: string
  size: number
}

/** Which game a stored file is, kept beside it in the index */
export interface StoredGameAbout {
  fileName: string
  platform: string
}

// Told whenever the index changes, here or in another tab
const changes = new EventTarget()

/** Whether this browser can keep games in storage and read them as they play: on pages isolated for threads */
export function canStoreGames() {
  return (
    globalThis.crossOriginIsolated &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/** The name a game file is stored under */
export function getStoredName(fileId: string) {
  return fileId.replaceAll(/[^\w.-]/gu, '_')
}

/** The file id a stored name came from, as in roms_psp_0b8b3d73.cso from roms/psp/0b8b3d73.cso */
export function parseStoredName(name: string) {
  const match = /^roms_(?<platform>.+)_(?<file>[^_]+)$/u.exec(name)
  return match?.groups
    ? { fileId: `roms/${match.groups.platform}/${match.groups.file}`, platform: match.groups.platform }
    : undefined
}

export function readIndex(): Record<string, StoredGame> {
  try {
    return JSON.parse(localStorage.getItem(indexKey) || '{}') as Record<string, StoredGame>
  } catch {
    return {}
  }
}

function writeIndex(index: Record<string, StoredGame>) {
  try {
    localStorage.setItem(indexKey, JSON.stringify(index))
  } catch {}
  changes.dispatchEvent(new Event('change'))
}

/** For useSyncExternalStore: calls back when the stored games change */
export function subscribeStoredGames(callback: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === indexKey) {
      callback()
    }
  }
  changes.addEventListener('change', callback)
  globalThis.addEventListener('storage', onStorage)
  return () => {
    changes.removeEventListener('change', callback)
    globalThis.removeEventListener('storage', onStorage)
  }
}

/** The index as it's kept, a string that only changes when the index does, for useSyncExternalStore */
export function getStoredGamesSnapshot() {
  try {
    return localStorage.getItem(indexKey) || '{}'
  } catch {
    return '{}'
  }
}

/** The stored games, after dropping any whose file the browser has cleared */
export async function listStoredGames() {
  const index = readIndex()
  if (typeof navigator.storage?.getDirectory !== 'function') {
    return []
  }
  const directory = await getDirectory()
  let changed = false
  for (const name of Object.keys(index)) {
    try {
      await directory.getFileHandle(name)
    } catch {
      delete index[name]
      changed = true
    }
  }
  if (changed) {
    writeIndex(index)
  }
  return Object.entries(index)
    .map(([name, game]) => Object.assign(game, { name }))
    .toSorted((a, b) => b.lastPlayed - a.lastPlayed)
}

/** Removes a stored game; it downloads again the next time it's played */
export async function removeStoredGame(name: string) {
  const directory = await getDirectory()
  await attemptAsync(() => directory.removeEntry(name))
  forget(name)
}

export async function removeAllStoredGames() {
  const directory = await getDirectory()
  for (const name of Object.keys(readIndex())) {
    await attemptAsync(() => directory.removeEntry(name))
  }
  writeIndex({})
}

/** Fills in which game a stored file is, for one stored before that was kept */
export function describeStoredGame(name: string, about: StoredGameAbout) {
  const index = readIndex()
  const entry = index[name]
  if (entry && (entry.fileName !== about.fileName || entry.platform !== about.platform)) {
    index[name] = { ...entry, ...about }
    writeIndex(index)
  }
}

async function getDirectory() {
  const root = await navigator.storage.getDirectory()
  return await root.getDirectoryHandle('games', { create: true })
}

/**
 * Whether the game at `url` is stored in full, and is the version the NAS has. Without a connection to ask, the stored
 * copy is used as it is
 */
export async function hasStoredGame(name: string, url: string) {
  const entry = readIndex()[name]
  if (!entry) {
    return false
  }
  try {
    const directory = await getDirectory()
    const handle = await directory.getFileHandle(name)
    const file = await handle.getFile()
    if (file.size !== entry.size) {
      forget(name)
      return false
    }
  } catch {
    forget(name)
    return false
  }
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const etag = response.headers.get('ETag')
    if (response.ok && etag && entry.etag && etag !== entry.etag) {
      forget(name)
      return false
    }
  } catch {}
  return true
}

function forget(name: string) {
  const index = readIndex()
  delete index[name]
  writeIndex(index)
}

/** Removes the least recently played games until those left fit the limit, never `keep` */
async function makeRoom(keep: string, needed = 0) {
  const index = readIndex()
  const directory = await getDirectory()
  const others = Object.entries(index)
    .filter(([name]) => name !== keep)
    .toSorted(([, a], [, b]) => a.lastPlayed - b.lastPlayed)
  let total = sumBy(Object.values(index), ({ size }) => size) + needed
  for (const [name, { size }] of others) {
    if (total <= storageLimit) {
      break
    }
    await attemptAsync(() => directory.removeEntry(name))
    delete index[name]
    total -= size
  }
  writeIndex(index)
  // Files the index doesn't know, from downloads cut short
  for await (const name of (directory as unknown as { keys: () => AsyncIterable<string> }).keys()) {
    if (!index[name] && name !== keep) {
      await attemptAsync(() => directory.removeEntry(name))
    }
  }
}

/** Marks a stored game as just played, so it's the last to be removed */
export function markPlayed(name: string, about?: StoredGameAbout) {
  const index = readIndex()
  if (index[name]) {
    index[name] = { ...index[name], ...about, lastPlayed: Date.now() }
    writeIndex(index)
  }
}

function startWorker() {
  return new Worker(new URL('game-storage.worker.ts', import.meta.url), { type: 'module' })
}

/** Downloads a game into storage, never holding it whole in memory. Resolves with its size */
export async function storeGame(
  name: string,
  url: string,
  {
    about,
    onProgress,
  }: { about?: StoredGameAbout; onProgress?: (loaded: number, total: number | undefined) => void } = {},
) {
  forget(name)
  function attempt() {
    return new Promise<{ etag?: string; size: number }>((resolve, reject) => {
      const worker = startWorker()
      worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
        if (data.type === 'progress') {
          onProgress?.(data.loaded, data.total)
        } else if (data.type === 'stored') {
          worker.terminate()
          resolve({ etag: data.etag, size: data.size })
        } else if (data.type === 'error') {
          worker.terminate()
          reject(new Error(data.error))
        }
      })
      worker.addEventListener('error', (event) => {
        worker.terminate()
        reject(new Error(event.message))
      })
      worker.postMessage({ name, type: 'store', url } satisfies StoreMessage, [])
    })
  }
  let stored: { etag?: string; size: number }
  try {
    stored = await attempt()
  } catch (error) {
    // Out of space: the other games go, and it's tried once more
    if (!String(error).includes('QuotaExceeded')) {
      throw error
    }
    await makeRoom(name, Number.POSITIVE_INFINITY)
    stored = await attempt()
  }
  writeIndex({ ...readIndex(), [name]: { ...stored, ...about, lastPlayed: Date.now() } })
  await attemptAsync(() => makeRoom(name))
  return stored.size
}

/** Reads a stored game as the emulator asks, blocking until each read is answered, which takes well under a millisecond */
export interface GameReader {
  close: () => void
  // eslint-disable-next-line max-params -- as Emscripten reads a file
  read: (target: Int8Array | Uint8Array, offset: number, position: number, length: number) => number
  size: number
}

export async function openGameReader(name: string): Promise<GameReader> {
  const buffer = new SharedArrayBuffer(dataOffset + readChunk)
  const control = new Int32Array(buffer, 0, 4)
  const position = new Float64Array(buffer, 16, 1)
  const data = new Uint8Array(buffer, dataOffset)
  const worker = startWorker()
  const size = await new Promise<number>((resolve, reject) => {
    worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === 'ready') {
        resolve(data.size)
      } else if (data.type === 'error') {
        reject(new Error(data.error))
      }
    })
    worker.addEventListener('error', (event) => reject(new Error(event.message)))
    worker.postMessage({ buffer, name, type: 'read' } satisfies ReadMessage, [])
  })

  function request(at: number, length: number) {
    position[0] = at
    Atomics.store(control, 1, length)
    Atomics.store(control, 0, readState.request)
    Atomics.notify(control, 0)
    // The page can't sleep while it waits, so it checks until the answer is there
    while (Atomics.load(control, 0) !== readState.done) {
      // waiting
    }
    const failed = Atomics.load(control, 3) !== 0
    const count = Atomics.load(control, 2)
    Atomics.store(control, 0, readState.idle)
    if (failed) {
      throw new Error('Reading the stored game failed')
    }
    return count
  }

  let closed = false
  return {
    close() {
      if (!closed) {
        closed = true
        position[0] = 0
        Atomics.store(control, 1, -1)
        Atomics.store(control, 0, readState.request)
        Atomics.notify(control, 0)
        setTimeout(() => worker.terminate(), 1000)
      }
    },
    // eslint-disable-next-line max-params -- as Emscripten reads a file
    read(target, offset, at, length) {
      let done = 0
      while (done < length) {
        const count = request(at + done, Math.min(length - done, readChunk))
        if (count === 0) {
          break
        }
        // Copied as bytes, whatever kind of array the emulator's memory is viewed through
        new Uint8Array(target.buffer, target.byteOffset + offset + done, count).set(data.subarray(0, count))
        done += count
      }
      return done
    },
    size,
  }
}
