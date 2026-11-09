import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { after, before, describe, it } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getFilePartialDigest } from '#@/utils/server/file.ts'
import { DiskFile, streamFormData } from '#@/utils/server/stream-form-data.ts'

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'retroassembly-stream-form-data-'))
const uploadsDirectory = path.join(dataDirectory, 'tmp', 'uploads')

function createApp() {
  return new Hono().post(
    '/',
    streamFormData(),
    zValidator('form', z.object({ file: z.instanceof(File), platform: z.string() })),
    async (c) => {
      const { file, platform } = c.req.valid('form')
      return c.json({
        bytes: Buffer.from(await file.arrayBuffer()).toString('base64'),
        digest: await getFilePartialDigest(file),
        isDiskFile: file instanceof DiskFile,
        name: file.name,
        platform,
        size: file.size,
        temporaryFiles: fs.readdirSync(uploadsDirectory).length,
      })
    },
  )
}

function listUploads() {
  return fs.existsSync(uploadsDirectory) ? fs.readdirSync(uploadsDirectory) : []
}

await describe('streamFormData', async () => {
  let previousDataDirectory: string | undefined

  before(() => {
    previousDataDirectory = process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY
    process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = dataDirectory
  })

  after(() => {
    if (previousDataDirectory === undefined) {
      delete process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY
    } else {
      process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = previousDataDirectory
    }
    fs.rmSync(dataDirectory, { force: true, recursive: true })
  })

  await it('hands the handler a disk-backed file identical to the upload and removes it afterwards', async () => {
    const content = new Uint8Array(300_000).map((_, index) => (index * 7) % 251)
    const original = new File([content], 'Gran Turismo 2 (Disc 1) – é.chd')
    const body = new FormData()
    body.append('platform', 'psx')
    body.append('file', original)

    const response = await createApp().request('/', { body, method: 'POST' })
    assert.equal(response.status, 200)
    const result = await response.json()

    assert.equal(result.isDiskFile, true)
    assert.equal(result.name, original.name)
    assert.equal(result.platform, 'psx')
    assert.equal(result.size, original.size)
    assert.equal(result.temporaryFiles, 1)
    assert.deepEqual(Buffer.from(result.bytes, 'base64'), Buffer.from(content))
    assert.equal(result.digest, await getFilePartialDigest(original))
    assert.deepEqual(listUploads(), [])
  })

  await it('rejects a malformed body with 400 and leaves no temporary files', async () => {
    const response = await createApp().request('/', {
      body: '--boundary\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\npartial',
      headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' },
      method: 'POST',
    })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Malformed FormData request/u)
    assert.deepEqual(listUploads(), [])
  })

  await it('rejects a multipart content type without a boundary with 400', async () => {
    const response = await createApp().request('/', {
      body: 'irrelevant',
      headers: { 'Content-Type': 'multipart/form-data' },
      method: 'POST',
    })
    assert.equal(response.status, 400)
  })

  await it('fails with 500 instead of hanging when a temporary file cannot be written', async () => {
    fs.chmodSync(uploadsDirectory, 0o500)
    try {
      const body = new FormData()
      body.append('platform', 'psx')
      body.append('file', new File([new Uint8Array(1024 * 1024)], 'rom.bin'))
      const response = await createApp().request('/', { body, method: 'POST' })
      assert.equal(response.status, 500)
    } finally {
      fs.chmodSync(uploadsDirectory, 0o700)
    }
    assert.deepEqual(listUploads(), [])
  })

  await it('handles an upload that is aborted mid-file without crashing', async () => {
    const head = '--boundary\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\n'
    const body = Readable.toWeb(
      Readable.from(
        (async function* body() {
          yield Buffer.from(head + 'x'.repeat(64 * 1024))
          await setTimeout(20)
          throw new Error('client went away')
        })(),
      ),
    ) as ReadableStream
    const response = await createApp().request('/', {
      body,
      duplex: 'half',
      headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' },
      method: 'POST',
    } as RequestInit)
    assert.equal(response.status, 400)
    assert.deepEqual(listUploads(), [])
  })
})

await describe('DiskFile', async () => {
  const content = new Uint8Array(5000).map((_, index) => index % 256)
  const filePath = path.join(os.tmpdir(), `retroassembly-disk-file-${process.pid}`)

  before(() => fs.writeFileSync(filePath, content))
  after(() => fs.rmSync(filePath, { force: true }))

  function createDiskFile() {
    return new DiskFile({ end: content.byteLength, filePath, modules: { fs, Readable }, name: 'rom.bin' })
  }

  await it('matches a native Blob for every kind of slice', async () => {
    const blob = new Blob([content])
    const diskFile = createDiskFile()
    const ranges: [number?, number?][] = [
      [],
      [0, 1024],
      [-1024],
      [100, 50],
      [10, 99_999],
      [-99_999, 10],
      [4999, 5000],
      [0, 0],
    ]
    for (const [start, end] of ranges) {
      const expected = new Uint8Array(await blob.slice(start, end).arrayBuffer())
      const slice = diskFile.slice(start, end)
      assert.equal(slice.size, expected.byteLength, `size of slice(${start}, ${end})`)
      assert.deepEqual(new Uint8Array(await slice.arrayBuffer()), expected, `bytes of slice(${start}, ${end})`)
      assert.deepEqual(new Uint8Array(await new Response(slice.stream()).arrayBuffer()), expected)
    }
    const nested = diskFile.slice(100, 4000).slice(-500, -100)
    assert.deepEqual(new Uint8Array(await nested.arrayBuffer()), content.slice(3500, 3900))
  })

  await it('reports the right size for files of 4 GiB or more', async () => {
    const sparsePath = `${filePath}-sparse`
    const size = 5 * 1024 ** 3 + 123
    try {
      const handle = await fs.promises.open(sparsePath, 'w')
      await handle.truncate(size)
      await handle.write(Buffer.from('tail'), 0, 4, size - 4)
      await handle.close()

      const diskFile = new DiskFile({ end: size, filePath: sparsePath, modules: { fs, Readable }, name: 'disc.iso' })
      assert.equal(diskFile.size, size)
      assert.equal(await diskFile.slice(-4).text(), 'tail')
    } finally {
      fs.rmSync(sparsePath, { force: true })
    }
  })
})
