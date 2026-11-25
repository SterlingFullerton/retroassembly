import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { defaultPreference, type ResolvedPreference } from '#@/constants/preference.ts'
import { getConsoleSummary } from '#@/pages/library/settings/consoles/console-summary.ts'

type ConsoleSettings = ResolvedPreference['emulator']['platform'][PlatformName]

/** The default settings with one console's changed */
function withConsole(platform: PlatformName, changes: Partial<ConsoleSettings>): ResolvedPreference {
  const platforms = defaultPreference.emulator.platform
  return {
    ...defaultPreference,
    emulator: {
      ...defaultPreference.emulator,
      platform: { ...platforms, [platform]: { ...platforms[platform], ...changes } },
    },
  }
}

await describe('what sets a console apart in the settings’ list', async () => {
  await it('is nothing for a console left as it came', () => {
    assert.deepEqual(getConsoleSummary(defaultPreference, 'gbc'), { biosMissing: false, differences: [] })
  })

  await it('names a shader of its own, rewinding switched off and another emulator', () => {
    const [, other] = platformMap.nes.cores
    const { differences } = getConsoleSummary(
      withConsole('nes', { core: other, rewindEnabled: false, shader: 'crt-easymode' }),
      'nes',
    )
    assert.deepEqual(
      differences.map(({ key }) => key),
      ['settings.ownShader', 'settings.rewindOff', undefined],
    )
    assert.ok(differences[2].text)
  })

  await it('says rewinding is on where it’s off by default', () => {
    const { differences } = getConsoleSummary(withConsole('psp', { rewindEnabled: true }), 'psp')
    assert.deepEqual(differences, [{ key: 'settings.rewindOn' }])
  })

  await it('doesn’t count the shader for all consoles as a console’s own', () => {
    assert.deepEqual(getConsoleSummary(withConsole('nes', { shader: 'inherit' }), 'nes').differences, [])
  })

  await it('tells a required BIOS file is missing until it’s there', () => {
    const console = (Object.keys(platformMap) as PlatformName[]).find((name) =>
      platformMap[name].bioses?.some(({ required }) => required),
    )
    assert.ok(console)
    assert.equal(getConsoleSummary(defaultPreference, console).biosMissing, true)
    const bioses = (platformMap[console].bioses ?? []).map(({ name }) => ({ fileName: name }))
    assert.equal(
      getConsoleSummary(withConsole(console, { bioses } as Partial<ConsoleSettings>), console).biosMissing,
      false,
    )
  })
})
