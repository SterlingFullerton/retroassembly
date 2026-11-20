// Writes what the TypeScript code answers for a set of inputs, for the Go server's tests to answer the same:
//   node scripts/go-test-fixtures.ts
// Run it after changing how settings are resolved or merged, or how games are searched
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type PreferenceSnippet, resolveUserPreference } from '#@/constants/preference.ts'
import { rank } from '#@/controllers/roms/search-roms.ts'
import { parseDisc } from '#@/utils/isomorphic/discs.ts'
import { mergePreference } from '#@/utils/isomorphic/preference.ts'
import { getRomCoverCandidates } from '#@/utils/isomorphic/rom-cover-candidates.ts'
import { getSearchTitle, normalizeSearchText, scoreRom } from '#@/utils/isomorphic/search.ts'
import { getArtworkPath, resolveCDNCacheTarget } from '#@/utils/server/cdn-cache.ts'
import { getCoverListUrl, getMatchedCoverUrl, getRegions, getTitleKey } from '#@/utils/server/libretro-covers.ts'

const resolveInputs: (null | PreferenceSnippet)[] = [
  null,
  {},
  { emulator: null, input: null, ui: null },
  { ui: { platforms: null } },
  { ui: { platforms: [] } },
  { ui: { language: 'de', platforms: ['nes', 'gba'] } },
  { ui: { saturation: 0, showTitle: false } },
  { input: { keyboardMapping: { input_player1_a: 'k' } } },
  { input: { gamepadMappings: { pad: { $pause: 'start' } } } },
  {
    emulator: { platform: { nes: { bioses: [{ fileId: 'bioses/nes/x.bin', fileName: 'x.bin' }], core: 'nestopia' } } },
  },
  { emulator: { core: { fceumm: null }, shader: 'crt' } },
  { emulator: { autoSaveInterval: 1.5 } },
]

const mergeInputs = [
  [{ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 } }],
  [{ a: [1, 2] }, { a: [3] }],
  [{ a: { b: 1 } }, { a: 'x' }],
  [{ a: null }, { a: { b: 1 } }],
  [{ a: 1 }, { a: 0, b: false, c: '' }],
  [{}, { a: { b: { c: null } } }],
]

const fixtures = {
  merge: mergeInputs.map(([target, source]) => ({ result: mergePreference(target, source), source, target })),
  resolve: resolveInputs.map((input) => ({ input, result: resolveUserPreference(input) })),
}

const fixturePath = path.join('server', 'internal', 'preference', 'testdata', 'typescript.json')
await writeFile(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`)
console.info(`Wrote ${fixturePath}`)

// Search: how games are ranked for a set of searches, typos included
const games = [
  ['Legend of Zelda, The - A Link to the Past (USA).sfc', 'snes', 'The Legend of Zelda: A Link to the Past', 900, true],
  ['Legend of Zelda, The (USA) (Rev 1).nes', 'nes', 'The Legend of Zelda', 700, false],
  ['Zelda II - The Adventure of Link (USA).nes', 'nes', 'Zelda II: The Adventure of Link', 400, false],
  ['Final Fantasy VII (USA) (Disc 1).cue', 'psx', 'Final Fantasy VII', 1000, false],
  ['Final Fantasy VI (Japan).sfc', 'snes', 'Final Fantasy VI', 300, false],
  ['Final Fantasy Tactics (USA).cue', 'psx', 'Final Fantasy Tactics', 500, true],
  ['Super Mario Bros. (World).nes', 'nes', 'Super Mario Bros.', 800, false],
  ['Super Mario 64 (USA).z64', 'n64', 'Super Mario 64', 950, false],
  ['Super Mario World (USA).sfc', 'snes', 'Super Mario World', 850, false],
  ['Dr. Mario (World).gb', 'gb', 'Dr. Mario', 200, false],
  ['Mario Kart 64 (USA).z64', 'n64', 'Mario Kart 64', 600, false],
  ['Spider-Man (USA).gba', 'gba', 'Spider-Man', 50, false],
  ['Pokemon - Red Version (USA, Europe).gb', 'gb', 'Pokémon Red Version', 700, false],
  ['Pokémon Stadium (USA).z64', 'n64', 'Pokémon Stadium', 300, false],
  ['Sonic the Hedgehog (World).md', 'genesis', 'Sonic the Hedgehog', 600, false],
  ['Sonic & Knuckles (World).md', 'genesis', 'Sonic & Knuckles', 300, false],
  ['sf2.zip', 'arcade', 'Street Fighter II: The World Warrior', 400, false],
  ['Street Fighter Alpha 3 (USA).cue', 'psx', 'Street Fighter Alpha 3', 200, false],
  ['Chrono Trigger (USA).sfc', 'snes', 'Chrono Trigger', 900, false],
  ['Tetris (World) (Rev 1).gb', 'gb', 'Tetris', 650, false],
  ['Q-bert (USA).nes', 'nes', 'Q*bert', 80, false],
  ['Pac-Man (USA).nes', 'nes', 'Pac-Man', 300, false],
  ['Ms. Pac-Man (USA).nes', 'nes', 'Ms. Pac-Man', 150, false],
  ['Mega Man 2 (USA).nes', 'nes', 'Mega Man 2', 500, false],
  ['Mega Man X (USA).sfc', 'snes', 'Mega Man X', 450, false],
  ['Kirby Super Star (USA).sfc', 'snes', null, 0, false],
  ['Demo (Proto).gba', 'gba', null, 0, false],
  ['Castlevania - Symphony of the Night (USA).cue', 'psx', 'Castlevania: Symphony of the Night', 700, false],
  ['Metroid Prime Hunters (USA).nds', 'nds', 'Metroid Prime: Hunters', 100, false],
  ['Über Racer (Europe).gba', 'gba', 'Über Racer', 3, false],
] as const
const credits: Record<string, [string, string]> = {
  'Chrono Trigger (USA).sfc': ['Square', 'Square'],
  'Mega Man 2 (USA).nes': ['Capcom', 'Capcom'],
  'Super Mario World (USA).sfc': ['Nintendo EAD', 'Nintendo'],
}
function candidates() {
  return games.map(([fileName, platform, gameName, popularity, isFavorite], index) => {
    const [gameDeveloper, gamePublisher] = credits[fileName] ?? [null, null]
    const gameTitle = index === 26 ? 'My Own Demo' : null
    return {
      fileName,
      gameDeveloper,
      gameName,
      gamePublisher,
      gameTitle,
      id: `g${index}`,
      isFavorite,
      platform,
      popularity,
      score: 0,
      title: gameTitle || (platform === 'arcade' && gameName ? gameName : getSearchTitle(fileName)),
    }
  })
}
const queries = [
  'zelda',
  'zel lin',
  'link to the past',
  'the legend',
  'Legend of Zelda',
  'ff7',
  'final fantasy 7',
  'final fantasy vi',
  'mario',
  'super mario',
  'sm64',
  'mario64',
  'dr mario',
  'dr. mario',
  'spiderman',
  'spider man',
  'pokemon',
  'pokémon',
  'sonic and',
  'sonic &',
  'street fighter',
  'streetfighter',
  'nintendo',
  'capcom',
  'square',
  'chrono',
  'tetris',
  'q bert',
  'pac',
  'mega man x',
  'kirby',
  'own demo',
  'uber',
  'ff',
  'x',
  '2',
  // Typos, which only the typo-tolerant search finds
  'zelad',
  'mraio kart',
  'sonik',
  'street fihgter',
  'chrono triger',
  'castelvania',
  'metriod',
  'pokemn stadium',
  'tetirs',
  'the legend of zelda a link to the pastt',
  'final fantasy tactics advance',
  'qwertyuiop',
]
const searchFixtures = {
  normalize: [
    "Pokémon: Let's Go & Fly!",
    'Übermensch — ÆON (ß)',
    '  Ｆｕｌｌ－ｗｉｄｔｈ  ',
    "Rock'n Roll",
    'café̃',
  ].map((text) => ({
    result: normalizeSearchText(text),
    text,
  })),
  rank: queries.map((query) => ({
    query,
    result: rank(candidates(), query).map(({ id, score }) => ({ id, score })),
  })),
  score: queries.flatMap((query) => candidates().map((candidate) => scoreRom(candidate, query))),
  titles: [
    'Dr. Mario (World).gb',
    'Game (USA) [!].zip',
    'No Extension',
    '(Japan).nes',
    'Name.v1.2 (Beta).gba',
    'a.b.c',
  ].map((fileName) => ({ fileName, result: getSearchTitle(fileName) })),
}
const searchFixturePath = path.join('server', 'internal', 'search', 'testdata', 'typescript.json')
await writeFile(searchFixturePath, `${JSON.stringify(searchFixtures, null, 2)}\n`)
console.info(`Wrote ${searchFixturePath}`)

// The CDN cache: which addresses it fetches, the pictures it looks for for a game, and libretro's box art matched by title
const coverNames = [
  "Legend of Zelda, The - Link's Awakening (USA) [!]",
  "The Legend of Zelda: Link's Awakening (Europe)",
  'Peek-A-Boo Poker (1991)(Panesian)(EU-US)',
  'Tetris (JU) [h1]',
  'Sonic & Knuckles (World)',
  'Pokémon - Édition Rouge (France)',
  'A Boy and His Blob (USA, Europe) (Beta)',
  'Super Mario Bros. (World) (Hack) [b1]',
  'Game (Asia) (En,Ja)',
  'Cotton 100% (Japan)',
]
const coverLists: Record<string, string[]> = {
  MAME: ['Street Fighter II - The World Warrior (World 910522)', 'Street Fighter II - The World Warrior (USA 910206)'],
  'Nintendo - Game Boy': ['Dr. Mario (World)', 'Dr. Mario (World) (Rev 1)', 'Tetris (Japan)', 'Tetris (World) (Rev 1)'],
  'Nintendo - Nintendo Entertainment System': [
    'Peek-A-Boo Poker (1991)(Panesian)(EU-US)',
    'Peek-A-Boo Poker (1991)(Panesian)(EU-US)[h Vimm][iNES title]',
    'Tetris (Japan)',
    'Tetris (USA)',
    'Tetris (USA) [b]',
    'Legend of Zelda, The (USA)',
    'Legend of Zelda, The (Europe) (Proto)',
    'Q-bert (USA)',
    'Mega Man 2 (Europe)',
    'Mega Man 2 (USA)',
  ],
  'Sony - PlayStation Portable': [
    'LEGO Batman - The Video Game (USA)',
    'LEGO Batman - The Video Game (Europe) (En,Fr,De,Es,It,Da)',
  ],
}
const coverRoms = [
  { fileName: 'Tetris (Japan) (En).gb', platform: 'gb', rawGameMetadata: null },
  { fileName: 'tetris.gb', platform: 'gb', rawGameMetadata: null },
  { fileName: 'Dr Mario.gb', platform: 'gb', rawGameMetadata: { libretro: { name: 'Dr. Mario (World)' } } },
  { fileName: 'Tetris (Europe).nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'zelda.nes', platform: 'nes', rawGameMetadata: { launchbox: { name: 'The Legend of Zelda' } } },
  { fileName: 'peekaboo.nes', platform: 'nes', rawGameMetadata: { launchbox: { name: 'Peek-A-Boo Poker' } } },
  { fileName: 'Q*bert (Japan).nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'Mega Man 2 (Europe).nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'Mega Man 2.nes', platform: 'nes', rawGameMetadata: null },
  {
    fileName: 'sf2.zip',
    platform: 'arcade',
    rawGameMetadata: {
      libretro: { name: 'Street Fighter II - The World Warrior (USA 910206)', platform: 'MAME 2003-Plus' },
    },
  },
  { fileName: 'LEGO Batman (USA).iso', platform: 'psp', rawGameMetadata: null },
  { fileName: 'Unknown Game (USA).nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'Pitfall.a26', platform: 'atari2600', rawGameMetadata: null },
]
const candidateRoms = [
  ...coverRoms,
  { fileName: 'Game: The "Sequel" | Part 2 <Beta> & More?.nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'A/B\\C*D`E.sfc', platform: 'snes', rawGameMetadata: null },
  { fileName: 'Game #1 (USA).gba', platform: 'gba', rawGameMetadata: null },
  { fileName: 'Cotton 100% (Japan).pce', platform: 'pcengine', rawGameMetadata: null },
  { fileName: 'Pokémon Ünïcode 日本.gb', platform: 'gb', rawGameMetadata: null },
  { fileName: '.hidden', platform: 'nes', rawGameMetadata: null },
  { fileName: 'Dots...nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'Tab\there{x}.nes', platform: 'nes', rawGameMetadata: null },
  { fileName: 'game.nes', platform: 'nes', rawGameMetadata: { libretro: { name: 'Named', platform: 'Sega - 32X' } } },
  {
    fileName: 'game.zip',
    platform: 'arcade',
    rawGameMetadata: { libretro: { name: 'x', platform: 'FBNeo - Arcade Games' } },
  },
  { fileName: '', platform: 'nes', rawGameMetadata: null },
]
const cachePaths = [
  'libretro-thumbnails/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World).png',
  'libretro-thumbnails/Nintendo - Game Boy/Named_Boxarts/Tetris (World).png',
  'libretro-thumbnails/Nintendo%20-%20Game%20Boy/Named_Boxarts/',
  'libretro-thumbnails/a/../../b.png',
  'libretro-thumbnails/a/%2e%2e/b.png',
  'libretro-thumbnails/',
  'libretro-thumbnails',
  'libretro-thumbnails//evil.example/x.png',
  'libretro-thumbnails/x.png?query=1#fragment',
  'jsdelivr/gh/libretro-thumbnails/Nintendo_-_Game_Boy@master/Named_Boxarts/Tetris%20(World).png',
  'jsdelivr/gh/libretro/retroarch-assets@2d24ef2972a709f870cc3f73853158fa2376f37d/xmb/icon.png',
  'jsdelivr/gh/libretro/retroarch-assets@other/xmb/icon.png',
  'jsdelivr/gh/libretro/glsl-shaders@468f67b6f6788e2719d1dd28dfb2c9b7c3db3cc7/crt/crt.glslp',
  'jsdelivr/gh/someone/else@1/file.js',
  'jsdelivr/gh/libretro%2Fdocs@35b22b41444b7d547d7f239669332c634acb455b/x',
  'jsdelivr/npm/anything@1/x.js',
  'jsdelivr/fontsource/fonts/inter:vf@5.2.8/latin-wght-normal.woff2',
  'jsdelivr/fontsource/fonts/inter:vf@5.2.9/latin-wght-normal.woff2',
  'jsdelivr/gh/libretro/docs@35b22b41444b7d547d7f239669332c634acb455b/docs/image/core/fceumm.png',
  'jsdelivr///evil.example/x',
  'unknown/x',
  '///libretro-thumbnails/x.png',
  'jsdelivr/gh/%E0%A4%A/x',
]
const artworkUrls = [
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris%20(World).png',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Snaps/Cotton%20100%%20(Japan).png',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Other/Tetris.png',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Tetris.jpg',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/.hidden.png',
  'https://thumbnails.libretro.com/a/b/Named_Boxarts/x.png',
  'https://thumbnails.libretro.com/%2E%2E/Named_Boxarts/x.png',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/%E0%A4%A.png',
  'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/a%00b.png',
  `https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/${'x'.repeat(220)}.png`,
  'https://cdn.jsdelivr.net/gh/libretro-thumbnails/Nintendo_-_Game_Boy@master/Named_Titles/Tetris%20(World).png',
  'https://cdn.jsdelivr.net/gh/libretro/retroarch-assets@1/Named_Boxarts/x.png',
]

const cdnDirectory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-go-fixtures-'))
const cdnSettings = { ...process.env }
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = cdnDirectory
process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE = 'true'
process.env.RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY = '/artwork'
try {
  // Each console's list of box art, as libretro's server lists it, in the cache
  const lists = Object.entries(coverLists).map(([folder, names]) => ({
    folder,
    html: `<a href="?C=N;O=D">Name</a>\n${names.map((name) => `<a href="${encodeURIComponent(name)}.png">${name}.png</a>`).join('\n')}`,
  }))
  const cacheDirectory = path.join(cdnDirectory, 'cache', 'cdn')
  await mkdir(cacheDirectory, { recursive: true })
  for (const { folder, html } of lists) {
    const key = createHash('sha256').update(getCoverListUrl(folder)).digest('hex')
    await writeFile(path.join(cacheDirectory, key), html)
    await writeFile(
      path.join(cacheDirectory, `${key}.json`),
      JSON.stringify({ contentType: 'text/html', status: 200, time: Date.now() }),
    )
  }
  const cdnFixtures = {
    artwork: artworkUrls.map((url) => ({ result: getArtworkPath(url) ?? null, url })),
    candidates: candidateRoms.map((rom) => ({ result: getRomCoverCandidates(rom), rom })),
    coverLists: lists,
    matched: await Promise.all(
      coverRoms.map(async (rom) => ({ result: (await getMatchedCoverUrl(rom, { offline: true })) ?? null, rom })),
    ),
    regions: coverNames.map((name) => ({ name, result: [...getRegions(name)] })),
    targets: cachePaths.map((cachePath) => {
      try {
        return { cachePath, result: resolveCDNCacheTarget(cachePath) ?? null }
      } catch (error) {
        return { cachePath, error: error instanceof Error ? error.name : 'Error' }
      }
    }),
    titleKeys: coverNames.map((name) => ({ name, result: getTitleKey(name) })),
  }
  const cdnFixturePath = path.join('server', 'internal', 'cdn', 'testdata', 'typescript.json')
  await mkdir(path.dirname(cdnFixturePath), { recursive: true })
  await writeFile(cdnFixturePath, `${JSON.stringify(cdnFixtures, null, 2)}\n`)
  console.info(`Wrote ${cdnFixturePath}`)
} finally {
  process.env = cdnSettings
  await rm(cdnDirectory, { force: true, recursive: true })
}

// A game on several discs: its name and disc number, from each disc's file name
const discNames = [
  'Chrono Cross (USA, Canada) (Disc 2).chd',
  'Rival Schools - United by Fate (USA) (Disc 2) (Evolution Disc).chd',
  'Final Fantasy VII (USA) (Disc 1 of 3).cue',
  'Policenauts (Japan) (Disk 3).bin',
  'Snatcher (CD 01).cue',
  'game (disc 2).iso',
  'Game (DISC 10).chd',
  'Game(Disc 2).chd',
  ' Spaced  (Disc 1).cue',
  '(Disc 1).cue',
  'Game (Disc A).cue',
  'Game (Disc 2',
  'Game (Disc 1) (Disc 2).cue',
  'A (Disc 1 of X).cue',
  'Tekken 3 (USA).cue',
  'Game (Disc 007).cue',
]
const discFixturePath = path.join('server', 'internal', 'library', 'testdata', 'discs.json')
await mkdir(path.dirname(discFixturePath), { recursive: true })
await writeFile(
  discFixturePath,
  `${JSON.stringify(
    discNames.map((fileName) => ({ fileName, result: parseDisc(fileName) ?? null })),
    null,
    2,
  )}\n`,
)
console.info(`Wrote ${discFixturePath}`)
