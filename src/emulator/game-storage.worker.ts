// Works with games kept in the browser's storage (its origin private file system), with the fast, direct access to a
// file that only a worker gets. Two jobs, each in a worker of its own:
// - store: downloads a game straight into storage, so the whole game is never in memory, reporting its progress
// - read: answers the emulator's reads of the game, as they come, through memory shared with the page

import { attemptAsync } from 'es-toolkit'
import {
  dataOffset,
  type ReadMessage,
  readState,
  type StoreMessage,
  type WorkerReply,
} from './game-storage-protocol.ts'

interface SyncAccessHandle {
  close: () => void
  flush: () => void
  getSize: () => number
  read: (buffer: Uint8Array, options: { at: number }) => number
  truncate: (size: number) => void
  write: (buffer: Uint8Array, options: { at: number }) => number
}

async function openHandle(name: string, create: boolean) {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle('games', { create: true })
  const file = await directory.getFileHandle(name, { create })
  return await (file as unknown as { createSyncAccessHandle: () => Promise<SyncAccessHandle> }).createSyncAccessHandle()
}

function reply(message: WorkerReply) {
  postMessage(message)
}

async function store({ name, url }: StoreMessage) {
  const handle = await openHandle(name, true)
  try {
    handle.truncate(0)
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    const length = Number(response.headers.get('Content-Length'))
    const total = !response.headers.get('Content-Encoding') && length > 0 ? length : undefined
    reply({ loaded: 0, total, type: 'progress' })
    const reader = response.body.getReader()
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      handle.write(value, { at: loaded })
      loaded += value.length
      reply({ loaded, total, type: 'progress' })
    }
    if (total !== undefined && loaded !== total) {
      throw new Error(`Received ${loaded} of ${total} bytes`)
    }
    handle.flush()
    reply({ etag: response.headers.get('ETag') ?? undefined, size: loaded, type: 'stored' })
  } finally {
    handle.close()
  }
}

async function read({ buffer, name }: ReadMessage) {
  const handle = await openHandle(name, false)
  const control = new Int32Array(buffer, 0, 4)
  const position = new Float64Array(buffer, 16, 1)
  const data = new Uint8Array(buffer, dataOffset)
  // Read into memory of its own first: not every browser reads a file into shared memory
  const scratch = new Uint8Array(data.length)
  reply({ size: handle.getSize(), type: 'ready' })
  for (;;) {
    Atomics.wait(control, 0, readState.idle)
    if (Atomics.load(control, 0) !== readState.request) {
      continue
    }
    const length = Atomics.load(control, 1)
    if (length < 0) {
      // Asked to stop: the game has ended
      handle.close()
      return
    }
    try {
      const count = handle.read(scratch.subarray(0, length), { at: position[0] })
      data.set(scratch.subarray(0, count))
      Atomics.store(control, 2, count)
      Atomics.store(control, 3, 0)
    } catch {
      Atomics.store(control, 3, 1)
    }
    Atomics.store(control, 0, readState.done)
    Atomics.notify(control, 0)
  }
}

async function handle(message: ReadMessage | StoreMessage) {
  const [error] = await attemptAsync(() => (message.type === 'store' ? store(message) : read(message)))
  if (error) {
    reply({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), type: 'error' })
  }
}

addEventListener('message', (event: MessageEvent<ReadMessage | StoreMessage>) => {
  queueMicrotask(() => handle(event.data))
})
