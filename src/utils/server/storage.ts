import path from 'node:path'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { getFilePath } from './storage-path.ts'

// Each kind of file in its own folder (see getFilePath). Ids that would reach outside it are treated as files that don't
// exist, or refused when writing
function getWritablePath(id: string) {
  const filePath = getFilePath(id)
  if (!filePath) {
    throw new Error('Invalid file id')
  }
  return filePath
}

export function createStorage() {
  return {
    async head(id: string) {
      const filePath = getFilePath(id)
      if (!filePath) {
        return false
      }
      const { default: fs } = await import('fs-extra')
      return fs.pathExists(filePath)
    },

    async put(id: string, file: Blob) {
      const filePath = getWritablePath(id)
      const { default: fs } = await import('fs-extra')
      await fs.ensureDir(path.dirname(filePath))
      const { DiskFile } = await import('./disk-file.ts')
      if (file instanceof DiskFile && (await file.moveTo(filePath))) {
        return
      }
      const { createWriteStream } = await import('node:fs')
      const { Readable } = await import('node:stream')
      const { pipeline } = await import('node:stream/promises')
      const { nanoid } = await import('./nanoid.ts')
      // Written under a temporary name first, so an interrupted write never leaves a partial file behind
      const partialFilePath = `${filePath}.${nanoid()}.partial`
      try {
        const readable = Readable.fromWeb(file.stream() as NodeReadableStream)
        await pipeline(readable, createWriteStream(partialFilePath))
        await fs.rename(partialFilePath, filePath)
      } finally {
        await fs.remove(partialFilePath)
      }
    },

    // Streams the file from disk as it's sent, so it never sits in memory whole whatever its size. Takes a range, for
    // partial requests
    async get(id: string, options?: { range?: { length?: number; offset: number } }) {
      const filePath = getFilePath(id)
      if (!filePath) {
        return
      }
      const { createReadStream } = await import('node:fs')
      const { stat } = await import('node:fs/promises')
      const { Readable } = await import('node:stream')
      const { mtimeMs, size } = await stat(filePath)
      const requested = options?.range
      const range =
        requested && requested.offset < size
          ? {
              end: Math.min(size, requested.offset + (requested.length ?? size - requested.offset)) - 1,
              offset: requested.offset,
            }
          : undefined
      const stream = createReadStream(filePath, range ? { end: range.end, start: range.offset } : {})
      return {
        body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        // Changes only when the file does, so a browser can tell it already has the current copy
        httpEtag: `"${size.toString(36)}-${Math.trunc(mtimeMs).toString(36)}"`,
        range,
        size,
      }
    },

    async delete(id: string) {
      const filePath = getWritablePath(id)
      const { default: fs } = await import('fs-extra')
      await fs.remove(filePath)
    },
  }
}
