import path from 'node:path'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { env } from 'hono/adapter'
import { getContext } from 'hono/context-storage'
import { getDirectories } from '../../constants/env.ts'

export function createStorage() {
  const c = getContext()
  const { BUCKET } = env<Env>(c)
  if (BUCKET) {
    return BUCKET
  }

  const { storageDirectory } = getDirectories()

  return {
    async head(id: string) {
      const filePath = path.join(storageDirectory, id)
      const { default: fs } = await import('fs-extra')
      return fs.pathExists(filePath)
    },

    async put(id: string, file: Blob) {
      const filePath = path.join(storageDirectory, id)
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

    // Streams the file from disk as it's sent, so it never sits in memory whole whatever its size. Takes the same range
    // option as an R2 bucket, for partial requests
    async get(id: string, options?: { range?: { length?: number; offset: number } }) {
      const filePath = path.join(storageDirectory, id)
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
      const filePath = path.join(storageDirectory, id)
      const { default: fs } = await import('fs-extra')
      await fs.remove(filePath)
    },
  }
}
