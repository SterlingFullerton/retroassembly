import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { it } from 'node:test'

const coresDir = path.join('src', 'assets', 'cores')

// The emulators built for this fork are committed as zips: each is listed with its fingerprint, so a rebuilt one is
// changed on purpose, with its line in SHA256SUMS, and never by accident
await it('has each bundled emulator zip listed in SHA256SUMS with its fingerprint', async () => {
  const sums = await readFile(path.join(coresDir, 'SHA256SUMS'), 'utf8')
  const listed = Object.fromEntries(
    sums
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+\*?/u).toReversed()),
  )
  const files = await readdir(coresDir)
  const zips = files.filter((file) => file.endsWith('.zip')).toSorted()
  assert.deepEqual(Object.keys(listed).toSorted(), zips)
  for (const zip of zips) {
    const content = await readFile(path.join(coresDir, zip))
    assert.equal(createHash('sha256').update(content).digest('hex'), listed[zip], zip)
  }
})

// The game service builds melonDS from source for the server, from a copy of the browser's patch at the browser's
// commit, so a game behaves alike in both: same buttons, same firmware
await it("builds the server's melonDS from the browser's patch, at the browser's commit", async () => {
  const browserPatch = await readFile(path.join(coresDir, 'melonds_libretro.patch'))
  const serverPatch = await readFile(path.join('nas-games', 'patches', 'melonds.patch'))
  assert.ok(
    browserPatch.equals(serverPatch),
    'nas-games/patches/melonds.patch differs from src/assets/cores/melonds_libretro.patch',
  )
  const readme = await readFile(path.join(coresDir, 'readme.md'), 'utf8')
  const dockerfile = await readFile(path.join('nas-games', 'Dockerfile'), 'utf8')
  const readmeCommit = /libretro\/melonDS\)\s+(?<commit>[0-9a-f]{7,40})\b/u.exec(readme)?.groups?.commit
  const dockerfileCommit = /git checkout (?<commit>[0-9a-f]{40})\b[^\n]*melonds\.patch/u.exec(dockerfile)?.groups
    ?.commit
  assert.ok(readmeCommit, "melonDS's commit not found in src/assets/cores/readme.md")
  assert.ok(dockerfileCommit, "melonDS's commit not found in nas-games/Dockerfile")
  assert.ok(dockerfileCommit.startsWith(readmeCommit), `${dockerfileCommit} is not ${readmeCommit}`)
})
