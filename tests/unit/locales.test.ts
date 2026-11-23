import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { locales } from '#@/locales/locales.ts'
import { localeNames } from '#@/locales/names.ts'

// Plural forms differ by language, so keys are compared without their plural suffix
function baseKeys(translation: Record<string, string>) {
  return [
    ...new Set(Object.keys(translation).map((key) => key.replace(/_(?:zero|one|two|few|many|other)$/u, ''))),
  ].toSorted()
}

await describe('languages', async () => {
  const english = locales.find(({ code }) => code === 'en')?.translation ?? {}

  for (const { code, translation } of locales) {
    await it(`${code} has the same text keys as English`, () => {
      assert.deepEqual(baseKeys(translation), baseKeys(english))
    })
  }

  await it('names every language that has text', () => {
    assert.deepEqual(
      localeNames.map(({ code }) => code),
      locales.map(({ code }) => code),
    )
  })
})
