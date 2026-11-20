// Writes what the TypeScript code answers for a set of inputs, for the Go server's tests to answer the same:
//   node scripts/go-test-fixtures.ts
// Run it after changing how settings are resolved or merged, or how games are searched
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type PreferenceSnippet, resolveUserPreference } from '#@/constants/preference.ts'
import { rank } from '#@/controllers/roms/search-roms.ts'
import { mergePreference } from '#@/utils/isomorphic/preference.ts'
import { getSearchTitle, normalizeSearchText, scoreRom } from '#@/utils/isomorphic/search.ts'

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
