// Writes what the Go server needs to know from the app's own TypeScript definitions to server/internal/shared, where it
// is built into the Go server. Run it after changing the consoles or emulators:
//   node scripts/go-shared-data.ts
// tests/unit/go-shared-data.test.ts fails when the file is out of date
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shadersRepository } from '#@/consoles/assets.ts'
import { emulators } from '#@/consoles/emulators.ts'
import { consoles } from '#@/consoles/registry.ts'
import type { ConsoleDefinition, EmulatorDefinition } from '#@/consoles/types.ts'
import { platforms } from '#@/constants/platform.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { locales } from '#@/locales/locales.ts'
import { repositoryVersions } from '#@/utils/isomorphic/cdn.ts'
import { fonts } from '#@/utils/isomorphic/fonts.ts'
import { dateFormatMap, defaultLanguage } from '#@/utils/isomorphic/i18n.ts'
import { getFixedPrefetchUrls } from '#@/utils/server/cdn-prefetch.ts'

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

// What the CDN cache needs: which files it may fetch (src/utils/server/cdn-cache.ts), the files the prefetch downloads
// whatever the library holds (src/utils/server/cdn-prefetch.ts), and where libretro keeps each console's art
function getCDNData() {
  // The prefetch's files by their own addresses, as they are with the cache off
  const cacheSetting = process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE
  process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE = 'false'
  try {
    return {
      fontPaths: fonts.map(({ path }) => `/${path}`),
      libretroNames: Object.fromEntries(platforms.map(({ libretroName, name }) => [name, libretroName ?? ''])),
      pinnedRepositories: { ...repositoryVersions, [shadersRepository.repository]: shadersRepository.version },
      prefetch: { assets: getFixedPrefetchUrls('assets'), shaders: getFixedPrefetchUrls('shaders') },
    }
  } finally {
    if (cacheSetting === undefined) {
      Reflect.deleteProperty(process.env, 'RETROASSEMBLY_RUN_TIME_CDN_CACHE')
    } else {
      process.env.RETROASSEMBLY_RUN_TIME_CDN_CACHE = cacheSetting
    }
  }
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
    cdn: getCDNData(),
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
    // The consoles whose games come on several discs, which are grouped into one game (src/utils/server/disc-groups.ts)
    multiDiscConsoles: Object.entries(consoles as Record<string, ConsoleDefinition>)
      .filter(([, { multiDisc }]) => multiDisc)
      .map(([name]) => name)
      .toSorted(),
    // The key of each console's name in the translations, for page titles
    platformNames: Object.fromEntries(platforms.map(({ displayNameI18nKey, name }) => [name, displayNameI18nKey])),
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
