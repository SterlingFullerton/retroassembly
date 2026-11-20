import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { emulators } from '#@/consoles/emulators.ts'
import { consoles, resolveConsole } from '#@/consoles/registry.ts'
import type { ConsoleDefinition } from '#@/consoles/types.ts'
import { getCoreUrl, isBundledCore } from '#@/utils/isomorphic/emulator-files.ts'

// Checks every console in the registry hangs together, so adding or changing one can't leave a piece out
const entries = Object.entries(consoles as Record<string, ConsoleDefinition>)
const localesDirectory = new URL('../../src/locales/', import.meta.url)
const localeFiles = await readdir(localesDirectory)
const locales = await Promise.all(
  localeFiles
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => ({ file, strings: JSON.parse(await readFile(new URL(file, localesDirectory), 'utf8')) })),
)

await describe('console registry conformance', async () => {
  await it('plays every console with known emulators, and each emulator with exactly one setup', () => {
    for (const [name, definition] of entries) {
      assert.ok(definition.cores.length > 0, `${name} has no emulator`)
      for (const core of definition.cores) {
        assert.ok(core in emulators, `${name}: unknown emulator ${core}`)
        const matching = (definition.setups ?? []).filter(({ cores }) => !cores || cores.includes(core))
        assert.ok(matching.length <= 1, `${name}/${core} matches ${matching.length} setups`)
        assert.ok(resolveConsole(name, core).console === definition)
      }
      for (const setup of definition.setups ?? []) {
        for (const core of setup.cores ?? []) {
          assert.ok(definition.cores.includes(core), `${name}: a setup names ${core}, which doesn't play it`)
        }
      }
    }
  })

  await it('ships every bundled emulator with the app', async () => {
    for (const core of Object.keys(emulators).filter((name) => isBundledCore(name))) {
      await access(new URL(`../../src/assets/cores/${core}_libretro.zip`, import.meta.url))
    }
  })

  await it('serves every emulator from the app itself', () => {
    const used = new Set(entries.flatMap(([, { cores }]) => cores))
    for (const core of [...used].filter((name) => !isBundledCore(name))) {
      assert.ok(getCoreUrl(core).startsWith('/cores/retroarch-'), `${core} isn't served by the app`)
    }
  })

  await it("has every console's name and notes in all languages", () => {
    assert.ok(locales.length >= 12)
    for (const [name, { displayNameI18nKey, info }] of entries) {
      for (const { file, strings } of locales) {
        assert.ok(strings[displayNameI18nKey], `${file} lacks ${displayNameI18nKey} (${name})`)
        assert.ok(strings[info.notesI18nKey], `${file} lacks ${info.notesI18nKey} (${name})`)
      }
    }
  })
})
