// Writes what the TypeScript code answers for a set of inputs, for the Go server's tests to answer the same:
//   node scripts/go-test-fixtures.ts
// Run it after changing how settings are resolved or merged
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type PreferenceSnippet, resolveUserPreference } from '#@/constants/preference.ts'
import { mergePreference } from '#@/utils/isomorphic/preference.ts'

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
