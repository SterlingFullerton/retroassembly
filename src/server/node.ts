import '../utils/server/migration/initalization.ts'
import '../utils/server/migration/raw-metadata.ts'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { RouterContextProvider, createRequestHandler } from 'react-router'
import { getAuthMode } from '#@/utils/server/auth.ts'
import { startCDNCachePrefetch } from '#@/utils/server/cdn-prefetch.ts'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore we can not guarantee that this file exists
import * as build from '../../dist/server/index.js'
import app from './app.ts'

getAuthMode()
startCDNCachePrefetch()

const pages = new Hono()
const requestHandler = createRequestHandler(build, 'production')
pages.all('*', (c) => requestHandler(c.req.raw, new RouterContextProvider()))

// Which build is running, so pages that are already open can tell the site has been updated under them
app.get('/build-version', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.text(String(build.assets.version))
})

// Built files named after a fingerprint of their contents (/assets/name-hash.ext) never change, so browsers can keep
// them for good. Files at a fixed address (the favicon, the manifest, artwork) can change in a new build, so browsers
// keep them but check each time
const staticRoot = path.resolve('dist/client')
const fingerprintedPath = /^\/assets\/[^/]+-[\w-]{8}\.\w+$/u

// Answers a check for an unchanged fixed-address file with 304, which the static file handler doesn't do itself
app.use(async (c, next) => {
  const since = Date.parse(c.req.header('If-Modified-Since') ?? '')
  if (c.req.method !== 'GET' || Number.isNaN(since) || fingerprintedPath.test(c.req.path)) {
    return next()
  }
  const filePath = path.join(staticRoot, decodeURIComponent(c.req.path))
  if (!filePath.startsWith(`${staticRoot}${path.sep}`)) {
    return next()
  }
  let stats: Awaited<ReturnType<typeof stat>> | undefined
  try {
    stats = await stat(filePath)
  } catch {
    return next()
  }
  // Last-Modified is sent in whole seconds
  if (stats.isFile() && Math.floor(stats.mtimeMs / 1000) * 1000 <= since) {
    return c.body(null, 304, { 'Cache-Control': 'no-cache', 'Last-Modified': stats.mtime.toUTCString() })
  }
  return next()
})

app.use(
  serveStatic({
    onFound: (filePath, c) => {
      const fingerprinted = fingerprintedPath.test(c.req.path)
      c.header('Cache-Control', fingerprinted ? 'public, immutable, max-age=31536000' : 'no-cache')
    },
    precompressed: true,
    root: 'dist/client',
  }),
)

app.route('', pages)

export { default } from './app.ts'
