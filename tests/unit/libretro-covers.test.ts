import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { getRomCoverCandidates } from '#@/utils/isomorphic/rom-cover-candidates.ts'
import { getCoverListUrl, getMatchedCoverUrl, getRegions, getTitleKey } from '#@/utils/server/libretro-covers.ts'

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'retroassembly-covers-'))

// Puts a console's list of box art in the cache, as libretro's server lists it
function cacheCoverList(consoleFolder: string, names: string[]) {
  const url = getCoverListUrl(consoleFolder)
  const key = createHash('sha256').update(url).digest('hex')
  const directory = path.join(dataDirectory, 'cache', 'cdn')
  fs.mkdirSync(directory, { recursive: true })
  const links = names.map((name) => `<a href="${encodeURIComponent(name)}.png">${name}.png</a>`).join('\n')
  fs.writeFileSync(path.join(directory, key), `<a href="?C=N;O=D">Name</a>\n${links}`)
  fs.writeFileSync(
    path.join(directory, `${key}.json`),
    JSON.stringify({ contentType: 'text/html', status: 200, time: Date.now() }),
  )
}

function coverName(url?: string) {
  return url ? decodeURIComponent(url.split('/').at(-1) ?? '').replace(/\.png$/u, '') : undefined
}

await describe('box art matched by title', async () => {
  before(() => {
    process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = dataDirectory
    process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE = 'true'
    cacheCoverList('Sony - PlayStation Portable', [
      'LEGO Batman - The Video Game (USA)',
      'LEGO Batman - The Video Game (Europe) (En,Fr,De,Es,It,Da)',
    ])
    cacheCoverList('Nintendo - Game Boy', ['After Burst (Japan)', 'Dr. Mario (World)'])
    cacheCoverList('Nintendo - Nintendo Entertainment System', [
      'Peek-A-Boo Poker (1991)(Panesian)(EU-US)',
      'Peek-A-Boo Poker (1991)(Panesian)(EU-US)[h Vimm][iNES title]',
      'Tetris (Japan)',
      'Tetris (USA)',
      'Tetris (USA) [b]',
    ])
    cacheCoverList('Atari - 2600', ["David Crane's Pitfall II - Lost Caverns (USA)"])
  })

  after(() => {
    delete process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY
    delete process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE
    fs.rmSync(dataDirectory, { force: true, recursive: true })
  })

  await it('reads titles the same whatever their tags, capitals or punctuation', () => {
    assert.equal(
      getTitleKey('LEGO Batman - The Videogame (USA) (En,Fr,Es)'),
      getTitleKey('LEGO Batman - The Video Game (USA)'),
    )
    assert.equal(
      getTitleKey("Legend of Zelda, The - Link's Awakening (U) [!]"),
      getTitleKey("The Legend of Zelda: Link's Awakening (Europe)"),
    )
    assert.equal(getTitleKey('Joust & Defender'), getTitleKey('Joust and Defender'))
    assert.notEqual(getTitleKey('Wario Land II (USA)'), getTitleKey('Wario Land (USA)'))
  })

  await it('reads regions from every naming style', () => {
    assert.deepEqual([...getRegions('Tetris (USA, Europe)')], ['usa', 'europe'])
    assert.deepEqual([...getRegions('Peek-A-Boo Poker (1991)(Panesian)(EU-US)')], ['europe', 'usa'])
    assert.deepEqual([...getRegions('Amida (J) [!]')], ['japan'])
  })

  await it("finds the PSP LEGO Batman box art under its other name, in the game's region", async () => {
    const url = await getMatchedCoverUrl(
      { fileName: 'LEGO Batman - The Videogame (USA) (En,Fr,Es).iso', platform: 'psp' },
      { offline: true },
    )
    assert.equal(coverName(url), 'LEGO Batman - The Video Game (USA)')
    assert.match(url ?? '', /^\/cdn\/libretro-thumbnails\/Sony%20-%20PlayStation%20Portable\/Named_Boxarts\//u)
  })

  await it("uses libretro's database name, then the file name, then the LaunchBox name", async () => {
    const afterBurst = await getMatchedCoverUrl(
      {
        fileName: 'After Burst (J).gb',
        platform: 'gb',
        rawGameMetadata: { libretro: { name: 'After Burst (Japan) (En)' } },
      },
      { offline: true },
    )
    assert.equal(coverName(afterBurst), 'After Burst (Japan)')
    const pitfall = await getMatchedCoverUrl(
      {
        fileName: 'Pitfall II - Lost Caverns (1984) (Activision) [!].a26',
        platform: 'atari2600',
        rawGameMetadata: { launchbox: { name: "David Crane's Pitfall II - Lost Caverns" } },
      },
      { offline: true },
    )
    assert.equal(coverName(pitfall), "David Crane's Pitfall II - Lost Caverns (USA)")
  })

  await it("prefers the game's own region, then a clean copy", async () => {
    const usa = await getMatchedCoverUrl({ fileName: 'Tetris (U) [!].nes', platform: 'nes' }, { offline: true })
    assert.equal(coverName(usa), 'Tetris (USA)')
    const japan = await getMatchedCoverUrl({ fileName: 'Tetris (J).nes', platform: 'nes' }, { offline: true })
    assert.equal(coverName(japan), 'Tetris (Japan)')
    const poker = await getMatchedCoverUrl(
      { fileName: 'Peek-A-Boo Poker (Panesian) [!].nes', platform: 'nes' },
      { offline: true },
    )
    assert.equal(coverName(poker), 'Peek-A-Boo Poker (1991)(Panesian)(EU-US)')
  })

  await it('finds nothing for a title libretro has no box art for', async () => {
    assert.equal(
      await getMatchedCoverUrl({ fileName: 'Not A Real Game (U).gb', platform: 'gb' }, { offline: true }),
      undefined,
    )
    assert.equal(
      await getMatchedCoverUrl({ fileName: 'Anything (U).gba', platform: 'gba' }, { offline: true }),
      undefined,
    )
  })

  await it('looks up a file name with full stops in it whole', () => {
    const candidates = getRomCoverCandidates({ fileName: 'Dr. Mario (World).gb', platform: 'gb' })
    assert.ok(candidates.some((url) => decodeURIComponent(url).endsWith('/Named_Boxarts/Dr. Mario (World).png')))
    assert.ok(!candidates.some((url) => url.endsWith('/Dr.png')))
  })
})
