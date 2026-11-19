import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { getAuthMode } from '#@/utils/server/auth.ts'
import { startCDNCachePrefetch } from '#@/utils/server/cdn-prefetch.ts'
import { compressPspGames } from '#@/utils/server/compress-psp-games.ts'
import { initializeDatabase } from '#@/utils/server/migration/initalization.ts'
import { backfillRawMetadata } from '#@/utils/server/migration/raw-metadata.ts'
import { createServer } from './create-server.ts'

interface BootOptions {
  hostname: string
  onListening: (port: number) => void
  port: number
}

const clientRoot = 'dist/client'

function runInBackground(name: string, job: () => unknown) {
  setImmediate(async () => {
    try {
      await job()
    } catch (error) {
      console.warn(`${name} failed`, error)
    }
  })
}

// The build's version is in the name of the manifest React Router writes, which index.html loads
function getBuildVersion(indexHtml: string) {
  const version = /\/assets\/manifest-(?<version>[\da-f]+)\.js/u.exec(indexHtml)?.groups?.version
  if (!version) {
    throw new Error(`No build version found in ${clientRoot}/index.html`)
  }
  return version
}

/**
 * Starts the app: checks the settings and brings the database up to date, then listens. Jobs that need the internet
 * (filling in game info, downloading emulator files for offline use) start only after that, so the library is up
 * quickly even when the internet isn't.
 */
export async function boot({ hostname, onListening, port }: BootOptions) {
  getAuthMode()
  await initializeDatabase()

  // Every page is the same page, which draws itself in the browser
  const indexHtml = await readFile(path.join(clientRoot, 'index.html'), 'utf8')
  const app = createServer({
    client: { root: clientRoot, version: getBuildVersion(indexHtml) },
    pages: (c) => c.html(indexHtml, 200, { 'Cache-Control': 'no-cache' }),
  })
  serve({ fetch: app.fetch, hostname, port }, (info) => onListening(info.port))

  runInBackground('Filling in game info', backfillRawMetadata)
  runInBackground('Downloading CDN files', startCDNCachePrefetch)
  runInBackground('Compressing PSP games', compressPspGames)
}
