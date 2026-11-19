import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { getGoSharedData, goSharedDataPath } from '../../scripts/go-shared-data.ts'

await it('gives the Go server the current consoles (run node scripts/go-shared-data.ts if not)', async () => {
  const written = JSON.parse(await readFile(goSharedDataPath, 'utf8'))
  assert.deepEqual(written, getGoSharedData())
})
