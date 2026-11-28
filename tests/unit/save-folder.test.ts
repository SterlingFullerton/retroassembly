import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { zipSaveFiles } from '#@/emulator/save-folder.ts'

const encoder = new TextEncoder()

await describe('a PSP save folder zipped in the browser', async () => {
  // The same files and checksum as nas-games/savezip/savezip_test.go: the game service zips a save the same way, so a
  // game played in the browser and on the server doesn't make a new version of an unchanged save each time
  await it('is the same bytes as the game service’s zip of the same files', () => {
    const zipped = zipSaveFiles([
      ['ULUS10376DATA00/PARAM.SFO', encoder.encode('param')],
      ['ULUS10376DATA00/DATA.BIN', new Uint8Array([0, 1, 2, 255, 254])],
      ['ICON0.PNG', encoder.encode('icon')],
      ['ULUS10376DATA00/sub/ö.bin', encoder.encode('unicode name')],
    ])
    assert.equal(zipped.length, 520)
    assert.equal(createHash('sha1').update(zipped).digest('hex'), 'a2a91b6e3d765be4737c8a028a4a80def6478d23')
  })
})
