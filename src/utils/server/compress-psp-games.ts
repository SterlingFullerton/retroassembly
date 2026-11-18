import path from 'node:path'
import { and, eq, like } from 'drizzle-orm'
import { noop } from 'es-toolkit'
import { romTable, statusEnum } from '#@/databases/schema.ts'
import { checkCso, compressIsoToCso, repairCsoEnd } from './cso.ts'
import { getDatabase } from './drizzle.ts'
import { getFilePath } from './storage-path.ts'

// PSP games are kept as CSO, compressed discs PPSSPP reads directly: smaller to download and to hold while playing.
// An uploaded ISO is playable straight away and compressed afterwards, in the background, one game at a time

// An ISO stays this long after its CSO replaces it, for pages that loaded before the swap and are about to download it
const isoKeptFor = 10 * 60 * 1000

/** The CSO a PSP ISO's file id is compressed to */
export function getCsoFileId(isoFileId: string) {
  return isoFileId.replace(/\.iso$/iu, '.cso')
}

/** Whether a game file is a PSP ISO this app compresses */
export function isCompressible(platform: string, fileId: string) {
  return platform === 'psp' && /\.iso$/iu.test(fileId)
}

let queue = Promise.resolve()
const queued = new Set<string>()
// ISOs replaced since the app started, kept for a while by their own timer
const replaced = new Set<string>()

/** Compresses a PSP ISO, after any already waiting. Resolves once it's done, or has failed and kept the ISO */
export function compressPspGame(isoFileId: string) {
  if (queued.has(isoFileId)) {
    return queue
  }
  queued.add(isoFileId)
  queue = queue
    .then(() => compress(isoFileId))
    .catch((error: unknown) => {
      console.warn(`Couldn't compress ${isoFileId}, keeping the ISO`, error)
    })
    .finally(() => {
      queued.delete(isoFileId)
    })
  return queue
}

async function compress(isoFileId: string) {
  const csoFileId = getCsoFileId(isoFileId)
  const isoPath = getFilePath(isoFileId)
  const csoPath = getFilePath(csoFileId)
  if (!isoPath || !csoPath || csoFileId === isoFileId) {
    return
  }
  const { default: fs } = await import('fs-extra')
  if (!(await fs.pathExists(isoPath))) {
    return
  }
  // A CSO already there is from another upload of the same disc, or an earlier run stopped before the swap
  if (!(await fs.pathExists(csoPath))) {
    const started = Date.now()
    const size = await compressIsoToCso(isoPath, csoPath)
    try {
      await checkCso(csoPath, isoPath)
    } catch (error) {
      await fs.remove(csoPath)
      throw error
    }
    const { size: isoSize } = await fs.stat(isoPath)
    const seconds = Math.round((Date.now() - started) / 1000)
    console.info(
      `Compressed ${isoFileId}: ${Math.round(isoSize / 1_048_576)} MB to ${Math.round(size / 1_048_576)} MB in ${seconds}s`,
    )
  }

  const { library } = getDatabase()
  library.update(romTable).set({ fileId: csoFileId }).where(eq(romTable.fileId, isoFileId)).run()
  replaced.add(isoFileId)
  setTimeout(() => {
    // By now the game may have been deleted too, taking its CSO with it; the ISO goes all the same
    removeUnusedIso(isoFileId, { evenWithoutCso: true }).catch(noop)
  }, isoKeptFor).unref()
}

/** Removes an ISO no game uses any more, once its CSO is in place */
async function removeUnusedIso(isoFileId: string, { evenWithoutCso = false } = {}) {
  const isoPath = getFilePath(isoFileId)
  const csoPath = getFilePath(getCsoFileId(isoFileId))
  const { library } = getDatabase()
  const [used] = library.select({ id: romTable.id }).from(romTable).where(eq(romTable.fileId, isoFileId)).limit(1).all()
  const { default: fs } = await import('fs-extra')
  if (isoPath && csoPath && !used && (evenWithoutCso || (await fs.pathExists(csoPath)))) {
    await fs.remove(isoPath)
  }
}

/**
 * At startup: compresses PSP ISOs uploaded before this existed, or whose compression was cut short, and removes ISOs
 * left behind by a restart during the wait after a swap
 */
export async function compressPspGames() {
  const { library } = getDatabase()
  const rows = library
    .selectDistinct({ fileId: romTable.fileId })
    .from(romTable)
    .where(and(eq(romTable.platform, 'psp'), eq(romTable.status, statusEnum.normal), like(romTable.fileId, '%.iso')))
    .all()
  for (const { fileId } of rows) {
    await compressPspGame(fileId)
  }

  const { default: fs } = await import('fs-extra')
  const directory = getFilePath('roms/psp')
  if (!directory || !(await fs.pathExists(directory))) {
    return
  }
  for (const name of await fs.readdir(directory)) {
    if (/\.cso$/iu.test(name) && (await repairCsoEnd(path.join(directory, name)).catch(() => false))) {
      console.info(`Repaired the end of roms/psp/${name}`)
    }
  }
  for (const name of await fs.readdir(directory)) {
    const fileId = path.posix.join('roms', 'psp', name)
    if (/\.iso$/iu.test(name) && !replaced.has(fileId)) {
      await removeUnusedIso(fileId)
    }
  }
}
