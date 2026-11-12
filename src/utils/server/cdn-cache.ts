import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { attemptAsync } from 'es-toolkit'
import { getDirectories } from '#@/constants/env.ts'
import { cdnCacheHosts, cdnHost, repositoryVersions } from '#@/utils/isomorphic/cdn.ts'
import { fonts } from '#@/utils/isomorphic/fonts.ts'
import { nanoid } from './nanoid.ts'

const fetchTimeout = 120_000
// A host that doesn't answer within this long is treated as unreachable
const headersTimeout = 10_000
// Files that don't exist upstream are remembered for this long, or forever for pinned versions
const notFoundTtl = 30 * 24 * 60 * 60 * 1000
// After a host fails to answer, requests to it are skipped for this long, so pages load quickly while offline
const unreachableBackoff = 5 * 60 * 1000

// Pinned repositories, plus the ones whose URLs are built elsewhere (emulator cores and shaders)
const pinnedRepositories: Record<string, string> = {
  ...repositoryVersions,
  'arianrhodsandlot/retroarch-emscripten-build': 'v1.22.2-1',
  'libretro/glsl-shaders': '468f67b6f6788e2719d1dd28dfb2c9b7c3db3cc7',
}
const pinnedPackages: Record<string, string> = { 'retroassembly-custom-cores': '1.22.2-20260719172358' }
const fontPaths = new Set(fonts.map(({ path }) => `/${path}`))

export interface CDNCacheTarget {
  /** Box art and screenshots are open-ended, so only logged-in users may add them to the cache */
  requiresLogin: boolean
  url: string
}

/**
 * Maps a path under `/cdn/` back to its upstream URL, or returns `undefined` if it is not something RetroAssembly
 * loads. This keeps the route from being used as an open proxy.
 */
export function resolveCDNCacheTarget(cachePath: string): CDNCacheTarget | undefined {
  const [name, ...rest] = cachePath.replace(/^\/+/u, '').split('/')
  const host = cdnCacheHosts[name as keyof typeof cdnCacheHosts]
  if (!host || rest.length === 0) {
    return
  }
  const url = new URL(rest.join('/'), host)
  if (url.origin !== new URL(host).origin) {
    return
  }

  if (name === 'libretro-thumbnails') {
    return { requiresLogin: true, url: url.href }
  }

  if (fontPaths.has(url.pathname)) {
    return { requiresLogin: false, url: url.href }
  }

  const [type, scope, ...segments] = url.pathname.slice(1).split('/')
  if (type === 'gh') {
    const [repository, version] = decodeURIComponent(segments[0] || '').split('@')
    const fullName = `${decodeURIComponent(scope || '')}/${repository}`
    if (decodeURIComponent(scope || '') === 'libretro-thumbnails') {
      return { requiresLogin: true, url: url.href }
    }
    if (pinnedRepositories[fullName] && pinnedRepositories[fullName] === version) {
      return { requiresLogin: false, url: url.href }
    }
  }
  if (type === 'npm') {
    const [packageName, version] = decodeURIComponent(scope || '').split('@')
    if (pinnedPackages[packageName] && pinnedPackages[packageName] === version) {
      return { requiresLogin: false, url: url.href }
    }
  }
}

interface CacheEntry {
  contentType: string
  status: number
  time: number
}

function getCacheDirectory() {
  return path.join(getDirectories().dataDirectory, 'cache', 'cdn')
}

function getCachePaths(url: string) {
  const key = createHash('sha256').update(url).digest('hex')
  const directory = getCacheDirectory()
  return { file: path.join(directory, key), meta: path.join(directory, `${key}.json`) }
}

function isPinned(url: string) {
  return url.startsWith(cdnHost) && /@(?!latest\/)[^/]+\//u.test(new URL(url).pathname)
}

async function readCacheEntry(url: string) {
  const paths = getCachePaths(url)
  const [, text] = await attemptAsync(() => fs.promises.readFile(paths.meta, 'utf8'))
  if (!text) {
    return
  }
  const entry: CacheEntry = JSON.parse(text)
  if (entry.status === 404) {
    const stale = !isPinned(url) && Date.now() - entry.time >= notFoundTtl
    return { ...entry, path: paths.file, size: 0, stale }
  }
  const [, stats] = await attemptAsync(() => fs.promises.stat(paths.file))
  return stats?.isFile() ? { ...entry, path: paths.file, size: stats.size, stale: false } : undefined
}

/** An error response from the CDN, as opposed to the CDN being unreachable */
class UpstreamError extends Error {
  override name = 'UpstreamError'
}

async function download(url: string) {
  const paths = getCachePaths(url)
  await fs.promises.mkdir(path.dirname(paths.file), { recursive: true })
  const controller = new AbortController()
  const headersTimer = setTimeout(() => controller.abort(new Error(`No response from ${url}`)), headersTimeout)
  const totalTimer = setTimeout(() => controller.abort(new Error(`Timed out fetching ${url}`)), fetchTimeout)
  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(headersTimer)
    if (response.status >= 400 && response.status < 500) {
      const entry: CacheEntry = { contentType: '', status: 404, time: Date.now() }
      await fs.promises.writeFile(paths.meta, JSON.stringify(entry))
      return
    }
    if (!response.ok || !response.body) {
      throw new UpstreamError(`Failed to fetch ${url}: ${response.status}`)
    }
    const partialFile = `${paths.file}.${nanoid()}.partial`
    try {
      // @ts-expect-error -- the DOM ReadableStream type differs from Node's, but they are the same at runtime
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partialFile))
      await fs.promises.rename(partialFile, paths.file)
    } finally {
      await fs.promises.rm(partialFile, { force: true })
    }
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
    const entry: CacheEntry = { contentType, status: 200, time: Date.now() }
    await fs.promises.writeFile(paths.meta, JSON.stringify(entry))
  } finally {
    clearTimeout(headersTimer)
    clearTimeout(totalTimer)
  }
}

const downloads = new Map<string, Promise<void>>()
const unreachableUntil = new Map<string, number>()

async function downloadOnce(url: string) {
  let pending = downloads.get(url)
  if (!pending) {
    pending = download(url)
    downloads.set(url, pending)
  }
  try {
    await pending
  } finally {
    downloads.delete(url)
  }
}

/**
 * Returns the cached file for `url`, downloading it first if needed. Concurrent requests share one download. When
 * the CDN can't be reached, a file that was known not to exist is still reported as missing instead of failing.
 */
/**
 * With `RETROASSEMBLY_RUN_TIME_CDN_OFFLINE=true`, pages are served only what's already in the cache, and nothing is
 * downloaded while they're browsed. Files are added only by the prefetch when the server starts
 */
export function isCDNCacheOffline() {
  return process.env.RETROASSEMBLY_RUN_TIME_CDN_OFFLINE === 'true'
}

export async function getCachedFile(url: string, { offline = false } = {}) {
  const cached = await readCacheEntry(url)
  if (cached && (!cached.stale || offline)) {
    return cached
  }
  if (offline) {
    return
  }
  const { host } = new URL(url)
  if ((unreachableUntil.get(host) ?? 0) > Date.now()) {
    if (cached) {
      return cached
    }
    throw new Error(`${host} is unreachable`)
  }
  const [error] = await attemptAsync(() => downloadOnce(url))
  if (error) {
    if (!(error instanceof UpstreamError)) {
      unreachableUntil.set(host, Date.now() + unreachableBackoff)
    }
    if (cached) {
      return cached
    }
    throw error
  }
  unreachableUntil.delete(host)
  return await readCacheEntry(url)
}

/**
 * Whether the cache holds a file (200), knows it doesn't exist upstream (404), or has yet to look for it (undefined).
 * A file last found missing long ago is looked for again, so it counts as not looked for, unless the server is offline
 */
export async function getCachedFileStatus(url: string, { offline = false } = {}) {
  const cached = await readCacheEntry(url)
  if (!cached || (cached.stale && !offline)) {
    return
  }
  return cached.status === 200 ? 200 : 404
}

export function createCachedFileStream(filePath: string) {
  // @ts-expect-error -- Node's web ReadableStream type differs from the DOM one, but they are the same at runtime
  const stream: ReadableStream = Readable.toWeb(fs.createReadStream(filePath))
  return stream
}

// Box art and artwork are large PNGs (an arcade box can be 700 KB) shown at a small size. A WebP copy, made once and
// kept next to the cached file, is about a seventh of the size at the same dimensions
const webPSourceTypes = new Set(['image/jpeg', 'image/png'])
const webPConversions = new Map<string, Promise<string | undefined>>()

async function convertToWebP(filePath: string) {
  const webPPath = `${filePath}.webp`
  const [, source] = await attemptAsync(() => fs.promises.stat(filePath))
  const [, copy] = await attemptAsync(() => fs.promises.stat(webPPath))
  if (!source) {
    return
  }
  // A copy older than the file (which has been downloaded again since) is made again
  if (copy && copy.mtimeMs >= source.mtimeMs) {
    return webPPath
  }
  const { default: sharp } = await import('sharp')
  const temporaryPath = `${webPPath}.${nanoid()}.tmp`
  await sharp(filePath).webp({ quality: 82 }).toFile(temporaryPath)
  await fs.promises.rename(temporaryPath, webPPath)
  return webPPath
}

/** The path and size of a WebP copy of a cached image, or nothing if the file isn't an image that can be converted */
export async function getCachedWebPCopy(cached: { contentType: string; path: string }) {
  if (!webPSourceTypes.has(cached.contentType.split(';')[0].trim().toLowerCase())) {
    return
  }
  // One conversion per file at a time, however many pages ask for it at once
  let conversion = webPConversions.get(cached.path)
  if (!conversion) {
    conversion = (async () => {
      try {
        const [, result] = await attemptAsync(() => convertToWebP(cached.path))
        return result ?? undefined
      } finally {
        webPConversions.delete(cached.path)
      }
    })()
    webPConversions.set(cached.path, conversion)
  }
  const webPPath = await conversion
  if (!webPPath) {
    return
  }
  const [, stats] = await attemptAsync(() => fs.promises.stat(webPPath))
  return stats ? { path: webPPath, size: stats.size } : undefined
}
