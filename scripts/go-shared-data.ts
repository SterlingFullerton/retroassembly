// Writes what the Go server needs to know from the app's own TypeScript definitions to server/internal/shared, where it
// is built into the Go server. Run it after changing the consoles or emulators:
//   node scripts/go-shared-data.ts
// tests/unit/go-shared-data.test.ts fails when the file is out of date
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emulators } from '#@/consoles/emulators.ts'
import { consoles } from '#@/consoles/registry.ts'
import type { EmulatorDefinition } from '#@/consoles/types.ts'
import { platforms } from '#@/constants/platform.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { locales } from '#@/locales/locales.ts'
import { dateFormatMap, defaultLanguage } from '#@/utils/isomorphic/i18n.ts'

// The messages the server writes itself: its errors, the titles of pages, and why logging in with OIDC failed
const serverMessages = new Set([
  'auth.login',
  'common.games',
  'error.exceedMaxRomCount',
  'error.sharedLibraryReadOnly',
  'nav.consoles',
  'nav.favorites',
  'nav.history',
  ...platforms.map(({ displayNameI18nKey }) => displayNameI18nKey),
])

function isServerMessage(key: string) {
  return serverMessages.has(key) || key.startsWith('auth.oidc_')
}

export const goSharedDataPath = path.join('server', 'internal', 'shared', 'shared.json')

export function getGoSharedData() {
  // The consoles whose game pages are sent with cross-origin isolation headers, as needsCrossOriginIsolation decides
  const threadedConsoles = Object.entries(consoles)
    .filter(([, { cores }]) =>
      cores.some((core) => (emulators[core] as EmulatorDefinition | undefined)?.launch?.threads),
    )
    .map(([name]) => name)
    .toSorted()
  return {
    // Each language's date format, for reading dates typed in it (src/utils/isomorphic/i18n.ts)
    dateFormats: dateFormatMap,
    defaultLanguage,
    // The settings a user starts with, before their own (src/constants/preference.ts)
    defaultPreference,
    // The languages, in order, with the messages the server writes in each (src/locales)
    languages: locales.map(({ code, translation }) => ({
      code,
      messages: Object.fromEntries(Object.entries(translation).filter(([key]) => isServerMessage(key))),
    })),
    // Every console, in the app's usual order (src/constants/platform.ts)
    platforms: platforms.map(({ name }) => name),
    threadedConsoles,
  }
}

export function formatGoSharedData() {
  return `${JSON.stringify(getGoSharedData(), null, 2)}\n`
}

if (import.meta.main) {
  await writeFile(goSharedDataPath, formatGoSharedData())
  console.info(`Wrote ${goSharedDataPath}`)
}
