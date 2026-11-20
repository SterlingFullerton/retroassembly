import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'node:test'
import { getGoSharedData, goSharedDataPath } from '../../scripts/go-shared-data.ts'

await it('gives the Go server the current consoles (run node scripts/go-shared-data.ts if not)', async () => {
  const written = JSON.parse(await readFile(goSharedDataPath, 'utf8'))
  assert.deepEqual(written, getGoSharedData())
})

await it('prefetches every file at the address the pages ask for, with no empty "//" segment', () => {
  const { cdn } = getGoSharedData() as { cdn: { prefetch: Record<string, string[]> } }
  const doubled = Object.values(cdn.prefetch)
    .flat()
    .filter((url) => new URL(url).pathname.includes('//'))
  assert.deepEqual(doubled, [])
})

await it('prefetches only files from the CDNs, not those the app serves itself', () => {
  const { cdn } = getGoSharedData() as { cdn: { prefetch: Record<string, string[]> } }
  assert.deepEqual(
    Object.values(cdn.prefetch)
      .flat()
      .filter((url) => !url.startsWith('https://')),
    [],
  )
})
