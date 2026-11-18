import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { getDirectories } from '#@/constants/env.ts'
import { getFilePath, getStoragePath } from '#@/utils/server/storage-path.ts'

const root = path.resolve('/data/storage')

await describe('stored file paths', async () => {
  await it('resolves stored files inside the storage directory', () => {
    assert.equal(getStoragePath(root, 'roms/abc.zip'), path.join(root, 'roms/abc.zip'))
    assert.equal(getStoragePath(root, 'a/./b/../c.bin'), path.join(root, 'a/c.bin'))
  })

  await it('refuses ids that reach outside the storage directory', () => {
    for (const id of ['../retroassembly.sqlite', 'roms/../../retroassembly.sqlite', '..', '/etc/passwd', '', '.']) {
      assert.equal(getStoragePath(root, id), undefined, id)
    }
  })

  await it('treats a sibling directory sharing the name prefix as outside', () => {
    assert.equal(getStoragePath(root, '../storage-other/x'), undefined)
  })
})

const storageDirectory = path.resolve('/data/storage')
const directories = {
  ...getDirectories(),
  biosesDirectory: path.resolve('/fast/bios'),
  gameSavesDirectory: path.resolve('/fast/game-saves'),
  romsDirectory: path.resolve('/big/roms'),
  statesDirectory: path.resolve('/fast/states'),
  storageDirectory,
}

await describe('each kind of file in its own folder', async () => {
  await it('puts each kind in its folder, keeping the rest of the id', () => {
    assert.equal(getFilePath('roms/nes/abc.nes', directories), path.resolve('/big/roms/nes/abc.nes'))
    assert.equal(getFilePath('bioses/psx/abc.bin', directories), path.resolve('/fast/bios/psx/abc.bin'))
    assert.equal(getFilePath('states/u/nes/r/s.state', directories), path.resolve('/fast/states/u/nes/r/s.state'))
    assert.equal(getFilePath('game-saves/u/nes/r/s.srm', directories), path.resolve('/fast/game-saves/u/nes/r/s.srm'))
  })

  await it('keeps anything else in the storage folder', () => {
    assert.equal(getFilePath('tmp/x', directories), path.join(storageDirectory, 'tmp/x'))
    assert.equal(getFilePath('romsx/a', directories), path.join(storageDirectory, 'romsx/a'))
  })

  await it('refuses ids that reach outside their folder', () => {
    for (const id of [
      'roms/../../x',
      'roms/..',
      'roms/',
      '../retroassembly.sqlite',
      '/etc/passwd',
      'states/../../../x',
    ]) {
      assert.equal(getFilePath(id, directories), undefined, id)
    }
  })

  await it('keeps the usual layout when no folder is set', () => {
    const usual = { ...getDirectories(), storageDirectory }
    for (const kind of ['bioses', 'game-saves', 'roms', 'states'] as const) {
      const key = {
        bioses: 'biosesDirectory',
        'game-saves': 'gameSavesDirectory',
        roms: 'romsDirectory',
        states: 'statesDirectory',
      }[kind]
      usual[key] = path.join(storageDirectory, kind)
      assert.equal(getFilePath(`${kind}/a/b`, usual), path.join(storageDirectory, kind, 'a/b'))
    }
  })
})

await describe('folder settings', async () => {
  await it('default to the storage and data folders', () => {
    const before = { ...process.env }
    process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = '/s'
    process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = '/d'
    try {
      const found = getDirectories()
      assert.equal(found.romsDirectory, path.join('/s', 'roms'))
      assert.equal(found.statesDirectory, path.join('/s', 'states'))
      assert.equal(found.gameSavesDirectory, path.join('/s', 'game-saves'))
      assert.equal(found.biosesDirectory, path.join('/s', 'bioses'))
      assert.equal(found.cacheDirectory, path.join('/d', 'cache'))
      process.env.RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY = '/big/roms'
      process.env.RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY = '/fast/cache'
      assert.equal(getDirectories().romsDirectory, '/big/roms')
      assert.equal(getDirectories().cacheDirectory, '/fast/cache')
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in before)) {
          delete process.env[key]
        }
      }
      Object.assign(process.env, before)
    }
  })
})
