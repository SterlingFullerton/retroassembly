// Writes what the Go server needs to know from the app's own TypeScript definitions to server/internal/shared, where it
// is built into the Go server. Run it after changing the consoles or emulators:
//   node scripts/go-shared-data.ts
// tests/unit/go-shared-data.test.ts fails when the file is out of date
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emulators } from '#@/consoles/emulators.ts'
import { consoles } from '#@/consoles/registry.ts'
import type { EmulatorDefinition } from '#@/consoles/types.ts'

export const goSharedDataPath = path.join('server', 'internal', 'shared', 'shared.json')

export function getGoSharedData() {
  // The consoles whose game pages are sent with cross-origin isolation headers, as needsCrossOriginIsolation decides
  const threadedConsoles = Object.entries(consoles)
    .filter(([, { cores }]) =>
      cores.some((core) => (emulators[core] as EmulatorDefinition | undefined)?.launch?.threads),
    )
    .map(([name]) => name)
    .toSorted()
  return { threadedConsoles }
}

export function formatGoSharedData() {
  return `${JSON.stringify(getGoSharedData(), null, 2)}\n`
}

if (import.meta.main) {
  await writeFile(goSharedDataPath, formatGoSharedData())
  console.info(`Wrote ${goSharedDataPath}`)
}
