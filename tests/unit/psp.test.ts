import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// The PSP: its game pages are cross-origin isolated, as its emulator runs on several threads, and its games' own saves,
// a folder of files, are kept as one zip
const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-psp-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

const { needsCrossOriginIsolation } = await import('#@/utils/isomorphic/cross-origin-isolation.ts')
const { unzipSaveFiles, zipSaveFiles } = await import('#@/emulator/save-folder.ts')
const { resolveConsole } = await import('#@/consoles/registry.ts')
const { initializeDatabase } = await import('#@/utils/server/migration/initalization.ts')
const { createServer } = await import('#@/server/create-server.ts')

const encoder = new TextEncoder()

function byName<T extends [string, ...unknown[]]>(entries: T[]) {
  return entries.toSorted(([a], [b]) => a.localeCompare(b))
}

await describe('PSP game pages', async () => {
  await it('isolates only PSP game pages', () => {
    assert.equal(needsCrossOriginIsolation('/library/platform/psp/rom/Lumines%20(USA).iso'), true)
    assert.equal(needsCrossOriginIsolation('/library/platform/psp/rom/Lumines (USA).iso'), true)
    assert.equal(needsCrossOriginIsolation('/library/platform/psp'), false)
    assert.equal(needsCrossOriginIsolation('/library/platform/psx/rom/Koudelka.chd'), false)
    assert.equal(needsCrossOriginIsolation('/library/roms'), false)
    assert.equal(needsCrossOriginIsolation('/library'), false)
    assert.equal(needsCrossOriginIsolation('/api/v1/roms'), false)
  })

  await it('runs PPSSPP on threads and keeps its saves as a folder', () => {
    const psp = resolveConsole('psp', 'ppsspp')
    assert.equal(psp.launch.threads, true)
    assert.equal(psp.saveFolder, 'PPSSPP/PSP/SAVEDATA')
    assert.equal(psp.saveFileType, 'zip')
    assert.equal(psp.controls, 'psp')
    const psx = resolveConsole('psx', 'pcsx_rearmed')
    assert.equal(psx.launch.threads, false)
    assert.equal(psx.saveFolder, null)
  })

  await describe('headers', async () => {
    let app: ReturnType<typeof createServer>
    before(async () => {
      await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
      await initializeDatabase()
      app = createServer({ pages: (c) => c.html('page') })
    })
    after(async () => {
      await rm(directory, { force: true, recursive: true })
    })

    await it('sends the isolation headers on a PSP game page, and on no other', async () => {
      const psp = await app.request('/library/platform/psp/rom/game.iso')
      assert.equal(psp.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')
      assert.equal(psp.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
      for (const page of ['/library', '/library/roms', '/library/platform/psp', '/library/platform/nes/rom/game.nes']) {
        const response = await app.request(page)
        assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), null, page)
        assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), null, page)
      }
    })

    await it('lets stored files load in a frame on an isolated page', async () => {
      const response = await app.request('/api/v1/files/missing.pdf')
      assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
    })
  })
})

await describe('PSP save folders', async () => {
  const files: [string, Uint8Array][] = [
    ['ULUS10041DATA00/PARAM.SFO', encoder.encode('param')],
    ['ULUS10041DATA00/DATA.BIN', new Uint8Array([0, 1, 2, 3, 255])],
    ['ULUS10041DATA00/ICON0.PNG', encoder.encode('icon')],
  ]

  await it('makes the same bytes for the same saves, whatever order they are read in', () => {
    assert.deepEqual(zipSaveFiles(files), zipSaveFiles(files.toReversed()))
    assert.notDeepEqual(
      zipSaveFiles(files),
      zipSaveFiles([...files, ['ULUS10041DATA01/DATA.BIN', new Uint8Array([9])]]),
    )
  })

  await it('reads back what it wrote', async () => {
    const read = await unzipSaveFiles(zipSaveFiles(files), 'SAVEDATA')
    assert.deepEqual(
      byName(read.map(([name, content]) => [name, [...content]])),
      byName(files.map(([name, content]) => [name, [...content]])),
    )
  })

  await it("reads a zip of the whole SAVEDATA folder as the folder's contents", async () => {
    const wrapped = zipSaveFiles(files.map(([name, content]) => [`SAVEDATA/${name}`, content]))
    const read = await unzipSaveFiles(wrapped, 'SAVEDATA')
    assert.deepEqual(
      byName(read).map(([name]) => name),
      byName(files).map(([name]) => name),
    )
  })

  await it('refuses a zip with anything that would land outside the folder', async () => {
    for (const name of ['../escape.bin', 'ULUS10041DATA00/a/../../b.bin']) {
      const unsafe = zipSaveFiles([
        [name, encoder.encode('no')],
        ['ULUS10041DATA00/KEEP.BIN', encoder.encode('yes')],
      ])
      await assert.rejects(() => unzipSaveFiles(unsafe, 'SAVEDATA'), name)
    }
    const absolute = await unzipSaveFiles(zipSaveFiles([['/absolute.bin', encoder.encode('no')]]), 'SAVEDATA').catch(
      () => [],
    )
    assert.deepEqual(absolute, [])
  })
})
