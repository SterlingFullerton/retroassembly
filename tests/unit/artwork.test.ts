import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import sharp from 'sharp'
import { getDirectories } from '#@/constants/env.ts'
import { getArtworkPath, getCachedFile, getCachedWebPCopy } from '#@/utils/server/cdn-cache.ts'
import { moveFolderContents } from '#@/utils/server/move-file.ts'
import { getFilePath } from '#@/utils/server/storage-path.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retroassembly-artwork-'))
const dataDirectory = path.join(root, 'data')
const artworkDirectory = path.join(root, 'artwork')
const boxart = 'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World).png'
const boxartPath = path.join(artworkDirectory, 'Nintendo - Game Boy', 'Named_Boxarts', 'Tetris (World).png')

// Writes a file into the cache the way it was kept before the artwork folder: under a name made from its address
function cacheAsBefore(url: string, entry: object, content?: Buffer) {
  const key = createHash('sha256').update(url).digest('hex')
  const directory = path.join(dataDirectory, 'cache', 'cdn')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, `${key}.json`), JSON.stringify(entry))
  if (content) {
    fs.writeFileSync(path.join(directory, key), content)
  }
  return path.join(directory, key)
}

function png() {
  return sharp({ create: { background: '#c00', channels: 3, height: 4, width: 4 } })
    .png()
    .toBuffer()
}

await describe('the artwork folder', async () => {
  before(() => {
    process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = dataDirectory
    process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(root, 'storage')
    process.env.RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY = artworkDirectory
  })

  after(() => {
    delete process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY
    delete process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY
    delete process.env.RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY
    fs.rmSync(root, { force: true, recursive: true })
  })

  await it("names libretro's art as libretro does, from either address", () => {
    assert.equal(getArtworkPath(boxart), boxartPath)
    assert.equal(
      getArtworkPath(
        'https://cdn.jsdelivr.net/gh/libretro-thumbnails/Nintendo_-_Game_Boy@d963e89/Named_Snaps/Tetris%20(World).png',
      ),
      path.join(artworkDirectory, 'Nintendo - Game Boy', 'Named_Snaps', 'Tetris (World).png'),
    )
  })

  await it('names art for games with a "%" in their name', () => {
    assert.equal(
      getArtworkPath(
        new URL(
          'Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Maerchen Adventure Cotton 100% (Japan).png',
          'https://thumbnails.libretro.com/',
        ).href,
      ),
      path.join(
        artworkDirectory,
        'Nintendo - Super Nintendo Entertainment System',
        'Named_Boxarts',
        'Maerchen Adventure Cotton 100% (Japan).png',
      ),
    )
  })

  await it('leaves everything else in the cache', () => {
    for (const url of [
      'https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroassembly-assets@feab5bc/platforms/icons/nes.png',
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Other/Tetris.png',
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris.txt',
      'https://thumbnails.libretro.com/..%2F..%2Fdata/Named_Boxarts/x.png',
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/..%2F..%2Fx.png',
      'https://thumbnails.libretro.com/.hidden/Named_Boxarts/x.png',
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Broken%E0%A4%A.png',
    ]) {
      assert.equal(getArtworkPath(url), undefined, url)
    }
  })

  await it('puts uploaded box art in the artwork folder', () => {
    assert.equal(getDirectories().attachmentsDirectory, path.join(artworkDirectory, 'attachments'))
    assert.equal(
      getFilePath('attachments/u/nes/r/a.png'),
      path.join(artworkDirectory, 'attachments', 'u', 'nes', 'r', 'a.png'),
    )
  })

  await it('uses art put in the folder by hand, without downloading it', async () => {
    fs.mkdirSync(path.dirname(boxartPath), { recursive: true })
    fs.writeFileSync(boxartPath, await png())
    const cached = await getCachedFile(boxart, { offline: true })
    assert.equal(cached?.status, 200)
    assert.equal(cached?.path, boxartPath)
    fs.rmSync(boxartPath)
  })

  await it('moves art cached before into the folder the first time it is needed, with its WebP copy', async () => {
    const url = 'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Titles/Kirby.png'
    const before = cacheAsBefore(url, { contentType: 'image/png', status: 200, time: Date.now() }, await png())
    const cached = await getCachedFile(url, { offline: true })
    const expected = path.join(artworkDirectory, 'Nintendo - Game Boy', 'Named_Titles', 'Kirby.png')
    assert.equal(cached?.path, expected)
    assert.equal(fs.existsSync(before), false)
    assert.equal(fs.existsSync(`${before}.json`), false)

    assert.ok(cached)
    const webP = await getCachedWebPCopy(cached)
    assert.equal(
      webP?.path,
      path.join(artworkDirectory, '.webp', 'Nintendo - Game Boy', 'Named_Titles', 'Kirby.png.webp'),
    )
    // Nothing but the art itself among the readable names
    assert.deepEqual(fs.readdirSync(path.dirname(expected)), ['Kirby.png'])
  })

  await it('keeps knowing art that does not exist, out of sight', async () => {
    const url = 'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Snaps/Missing.png'
    cacheAsBefore(url, { contentType: '', status: 404, time: Date.now() })
    const cached = await getCachedFile(url, { offline: true })
    assert.equal(cached?.status, 404)
    assert.equal(
      fs.existsSync(path.join(artworkDirectory, '.meta', 'Nintendo - Game Boy', 'Named_Snaps', 'Missing.png.json')),
      true,
    )
    assert.equal(fs.existsSync(path.join(artworkDirectory, 'Nintendo - Game Boy', 'Named_Snaps')), false)
  })

  await it('lets art added by hand win over art known not to exist', async () => {
    const url = 'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Snaps/Missing.png'
    const file = path.join(artworkDirectory, 'Nintendo - Game Boy', 'Named_Snaps', 'Missing.png')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, await png())
    const cached = await getCachedFile(url, { offline: true })
    assert.equal(cached?.status, 200)
    assert.equal(cached?.contentType, 'image/png')
  })

  await it('keeps emulator files in the cache folder', async () => {
    const url = 'https://cdn.jsdelivr.net/npm/some-core@1.0.0/core.wasm'
    const before = cacheAsBefore(
      url,
      { contentType: 'application/wasm', status: 200, time: Date.now() },
      Buffer.from('x'),
    )
    const cached = await getCachedFile(url, { offline: true })
    assert.equal(cached?.path, before)
  })
})

await describe('moving a folder', async () => {
  await it('moves every file, keeps one already there, and removes the folders left empty', async () => {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'retroassembly-move-from-'))
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'retroassembly-move-to-'))
    fs.mkdirSync(path.join(from, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(from, 'a', 'b', 'one.png'), '1')
    fs.writeFileSync(path.join(from, 'two.png'), 'new')
    fs.writeFileSync(path.join(to, 'two.png'), 'kept')

    assert.equal(await moveFolderContents(from, to), 1)
    assert.equal(fs.readFileSync(path.join(to, 'a', 'b', 'one.png'), 'utf8'), '1')
    assert.equal(fs.readFileSync(path.join(to, 'two.png'), 'utf8'), 'kept')
    // The file that wasn't moved keeps its folder
    assert.deepEqual(fs.readdirSync(from), ['two.png'])
    fs.rmSync(from, { force: true, recursive: true })
    fs.rmSync(to, { force: true, recursive: true })
  })
})
