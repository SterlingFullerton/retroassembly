import { attemptAsync } from 'es-toolkit'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { isCDNCacheEnabled } from '#@/utils/isomorphic/cdn.ts'

/** Serves `/cdn/*` from the server's cache of CDN files when `RETROASSEMBLY_RUN_TIME_CDN_CACHE` is enabled. */
export function cdnCache() {
  return createMiddleware(async (c, next) => {
    if (!isCDNCacheEnabled()) {
      await next()
      return
    }

    const { createCachedFileStream, getCachedFile, getCachedWebPCopy, resolveCDNCacheTarget } =
      await import('#@/utils/server/cdn-cache.ts')
    const cachePath = new URL(c.req.url).pathname.slice('/cdn/'.length)
    const target = resolveCDNCacheTarget(cachePath)
    if (!target) {
      throw new HTTPException(404, { message: 'Not found' })
    }
    if (target.requiresLogin && !c.var.currentUser) {
      throw new HTTPException(401, { message: 'Unauthorized' })
    }

    const [error, cached] = await attemptAsync(() => getCachedFile(target.url))
    if (error) {
      throw new HTTPException(502, { cause: error, message: 'Failed to fetch the file from the CDN.' })
    }
    if (!cached || cached.status === 404) {
      // Lets the browser skip files it already knows are missing, such as box art for games that have none
      return c.body(null, 404, { 'Cache-Control': 'public, max-age=86400' })
    }

    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    // Images are sent as a much smaller WebP copy to browsers that accept it, which is all current ones
    if (/image\/webp/iu.test(c.req.header('Accept') ?? '')) {
      c.header('Vary', 'Accept')
      const webP = await getCachedWebPCopy(cached)
      if (webP) {
        c.header('Content-Type', 'image/webp')
        c.header('Content-Length', String(webP.size))
        return c.body(createCachedFileStream(webP.path))
      }
    }
    c.header('Content-Type', cached.contentType)
    c.header('Content-Length', String(cached.size))
    return c.body(createCachedFileStream(cached.path))
  })
}
