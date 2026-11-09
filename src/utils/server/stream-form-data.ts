import { randomUUID } from 'node:crypto'
import type * as NodeFs from 'node:fs'
import path from 'node:path'
import type { Readable as NodeReadable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { MiddlewareHandler } from 'hono'
import { getRuntimeKey } from 'hono/adapter'
import { HTTPException } from 'hono/http-exception'
import { getDirectories } from '#@/constants/env.ts'

const multipartRegex = /^multipart\/form-data/iu

interface NodeModules {
  fs: typeof NodeFs
  Readable: typeof NodeReadable
}

/**
 * A File whose contents live on disk and are only read when consumed.
 *
 * `fs.openAsBlob()` is not used because Node reports a wrong `size` for files of 4 GiB or more
 * (the size wraps around at 2^32), which would break `getFilePartialDigest` for large disc images.
 */
export class DiskFile extends File {
  readonly #end: number
  readonly #filePath: string
  readonly #modules: NodeModules
  readonly #start: number

  override get size() {
    return this.#end - this.#start
  }

  constructor({
    end,
    filePath,
    modules,
    name,
    start = 0,
    type,
  }: {
    end: number
    filePath: string
    modules: NodeModules
    name: string
    start?: number
    type?: string
  }) {
    super([], name, { type })
    this.#modules = modules
    this.#filePath = filePath
    this.#start = start
    this.#end = end
  }

  override async arrayBuffer() {
    const handle = await this.#modules.fs.promises.open(this.#filePath)
    try {
      const buffer = new Uint8Array(this.size)
      let offset = 0
      while (offset < buffer.byteLength) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, this.#start + offset)
        if (bytesRead === 0) {
          break
        }
        offset += bytesRead
      }
      return buffer.buffer
    } finally {
      await handle.close()
    }
  }

  override async bytes() {
    return new Uint8Array(await this.arrayBuffer())
  }

  override slice(start = 0, end = this.size, contentType = '') {
    const resolve = (index: number) => (index < 0 ? Math.max(this.size + index, 0) : Math.min(index, this.size))
    const relativeStart = resolve(start)
    const relativeEnd = Math.max(resolve(end), relativeStart)
    return new DiskFile({
      end: this.#start + relativeEnd,
      filePath: this.#filePath,
      modules: this.#modules,
      name: this.name,
      start: this.#start + relativeStart,
      type: contentType,
    })
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const { fs, Readable } = this.#modules
    if (this.size === 0) {
      return new ReadableStream<Uint8Array<ArrayBuffer>>({ start: (controller) => controller.close() })
    }
    const readable = fs.createReadStream(this.#filePath, { end: this.#end - 1, start: this.#start })
    return Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array<ArrayBuffer>>
  }

  override async text() {
    return new TextDecoder().decode(await this.arrayBuffer())
  }
}

// Files left behind by a previous process (e.g. one that was killed mid-upload) are removed once per process,
// before this process writes any temporary files of its own.
const preparedDirectories = new Map<string, Promise<void>>()

async function resetTemporaryDirectory(fs: NodeModules['fs'], directory: string) {
  try {
    await fs.promises.rm(directory, { force: true, recursive: true })
    await fs.promises.mkdir(directory, { recursive: true })
  } catch (error) {
    preparedDirectories.delete(directory)
    throw error
  }
}

function prepareTemporaryDirectory(fs: NodeModules['fs'], directory: string) {
  let prepared = preparedDirectories.get(directory)
  if (!prepared) {
    prepared = resetTemporaryDirectory(fs, directory)
    preparedDirectories.set(directory, prepared)
  }
  return prepared
}

/**
 * Parse a multipart/form-data request body by streaming uploaded files straight to disk.
 *
 * Hono's `zValidator('form')` reads the whole request body into one ArrayBuffer and then
 * re-parses it into a FormData, keeping several in-memory copies of every uploaded file.
 * For multi-gigabyte ROMs (PlayStation ISOs/CHDs, etc.) this exhausts the memory of the
 * host and gets the process OOM-killed.
 *
 * On Node, this middleware parses the body with busboy, writes each file to a temporary
 * file under the data directory, and stores a disk-backed FormData in `bodyCache`, which
 * `zValidator('form')` then uses instead of buffering the body. Temporary files are removed
 * once the request has been handled. On other runtimes it does nothing.
 */
export function streamFormData(): MiddlewareHandler {
  return async (c, next) => {
    const contentType = c.req.header('Content-Type')
    const { body } = c.req.raw
    if (getRuntimeKey() !== 'node' || !contentType || !multipartRegex.test(contentType) || !body) {
      return await next()
    }

    const [{ default: busboy }, fs, { Readable }, { pipeline }] = await Promise.all([
      import('busboy'),
      import('node:fs'),
      import('node:stream'),
      import('node:stream/promises'),
    ])

    const { dataDirectory } = getDirectories()
    const temporaryDirectory = path.join(dataDirectory, 'tmp', 'uploads')
    await prepareTemporaryDirectory(fs, temporaryDirectory)

    const temporaryFiles: string[] = []
    try {
      const fields: [string, string][] = []
      const files: { fileName: string; filePath: string; mimeType: string; name: string }[] = []
      const writes: Promise<void>[] = []
      // The first error from writing a temporary file to disk, and from the upload itself
      let diskError: Error | undefined
      let uploadError: unknown

      let parser: ReturnType<typeof busboy>
      try {
        parser = busboy({ defParamCharset: 'utf8', headers: { 'content-type': contentType } })
      } catch (error) {
        const message = error instanceof Error ? ` ${error.message}` : ''
        throw new HTTPException(400, { message: `Malformed FormData request.${message}` })
      }
      parser.on('field', (name, value) => {
        fields.push([name, value])
      })
      parser.on('file', (name, stream, { filename, mimeType }) => {
        const filePath = path.join(temporaryDirectory, randomUUID())
        temporaryFiles.push(filePath)
        files.push({ fileName: filename, filePath, mimeType, name })
        async function write() {
          try {
            await pipeline(stream, fs.createWriteStream(filePath))
          } catch (error) {
            if (error instanceof Error && 'syscall' in error) {
              // The temporary file can't be written (e.g. the disk is full). Stop parsing, otherwise the parser
              // waits forever for this file stream to be drained.
              diskError ??= error
              parser.destroy(error)
            } else {
              // The upload itself failed, in which case the parser is already being torn down
              uploadError ??= error
            }
          }
        }
        writes.push(write())
      })

      try {
        await pipeline(Readable.fromWeb(body as NodeReadableStream), parser)
      } catch (error) {
        uploadError ??= error
      }
      await Promise.all(writes)
      if (diskError) {
        throw new HTTPException(500, { cause: diskError, message: 'Failed to store the uploaded file.' })
      }
      if (uploadError) {
        const message = uploadError instanceof Error ? ` ${uploadError.message}` : ''
        throw new HTTPException(400, { message: `Malformed FormData request.${message}` })
      }

      const formData = new FormData()
      for (const [name, value] of fields) {
        formData.append(name, value)
      }
      for (const { fileName, filePath, mimeType, name } of files) {
        // The file stays on disk; it is only read when consumed (partial digest, storage.put).
        const { size } = await fs.promises.stat(filePath)
        formData.append(
          name,
          new DiskFile({ end: size, filePath, modules: { fs, Readable }, name: fileName, type: mimeType }),
        )
      }
      c.req.bodyCache.formData = formData

      await next()
    } finally {
      await Promise.all(temporaryFiles.map((filePath) => fs.promises.rm(filePath, { force: true })))
    }
  }
}
