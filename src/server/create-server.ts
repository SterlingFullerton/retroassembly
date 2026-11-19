import { type Handler, Hono } from 'hono'
import { compress } from 'hono/compress'
import { contextStorage } from 'hono/context-storage'
import { app as api } from '#@/api/app.ts'
import { cdnCache } from '#@/middlewares/cdn-cache.ts'
import { globals } from '#@/middlewares/globals.ts'
import { logger } from '#@/middlewares/logger.ts'
import { vendors } from '#@/middlewares/vendors.ts'
import { crossOriginIsolationHeaders, needsCrossOriginIsolation } from '#@/utils/isomorphic/cross-origin-isolation.ts'
import { homeRoute, redirectRoutes } from './redirect-routes.ts'
import { staticFiles } from './static-files.ts'

interface ServerOptions {
  /** The built client files and the build's version, in production. In development Vite serves the files itself */
  client?: { root: string; version: string }
  /** Answers a page's address with the page, which draws itself in the browser */
  pages: Handler
}

// Stored files (games, saves, artwork) are mostly binary, some are labelled as text anyway, and compressing them would
// drop their size from downloads for no gain
const uncompressedPaths = [/^\/api\/v1\/files\//u, /^\/api\/v1\/roms\/[^/]+\/content$/u]

/**
 * The app's request pipeline, shared by development and production. Requests that need no user (the build's files,
 * robots.txt) are answered first; everything after them looks up the signed-in user and is logged.
 */
export function createServer({ client, pages }: ServerOptions) {
  const app = new Hono()
  app.use(contextStorage())

  // The game pages of consoles whose emulator runs on several threads (the PSP's) are cross-origin isolated
  app.use(async (c, next) => {
    await next()
    if (needsCrossOriginIsolation(c.req.path)) {
      for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
        c.header(name, value)
      }
    } else if (c.req.path.startsWith('/api/v1/files/') || /\.worker-[\w-]+\.js$/u.test(c.req.path)) {
      // A stored file opened in a frame on such a page, like a game's PDF manual, has to allow it too, and so does a
      // worker such a page starts, like the one reading a game kept in the browser's storage
      c.header('Cross-Origin-Embedder-Policy', crossOriginIsolationHeaders['Cross-Origin-Embedder-Policy'])
    }
  })

  // A private library, kept out of search engines
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /'))
  app.route('', homeRoute)
  if (client) {
    // Which build is running, so pages that are already open can tell the site has been updated under them
    app.get('/build-version', (c) => {
      c.header('Cache-Control', 'no-store')
      return c.text(client.version)
    })
    app.use(...staticFiles(client.root))
  }

  app.use(vendors(), globals(), logger())
  // Some cached CDN files are for signed-in users only
  app.get('/cdn/*', cdnCache())

  // Compresses what's made per request, like pages and API data
  const compressText = compress()
  app.use((c, next) => (uncompressedPaths.some((path) => path.test(c.req.path)) ? next() : compressText(c, next)))
  app.route('', api)
  app.route('', redirectRoutes)
  app.all('*', pages)
  return app
}
