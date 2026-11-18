import fs from 'node:fs'
import path from 'node:path'
import { attemptAsync } from 'es-toolkit'
import { nanoid } from './nanoid.ts'

/**
 * Moves a file, creating the folder it goes into. Between disks, where a rename can't work, it's copied under a
 * temporary name first and the original removed once the copy is complete, so neither is ever left half-written
 */
export async function moveFile(from: string, to: string) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.promises.rename(from, to)
    return
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EXDEV')) {
      throw error
    }
  }
  const partial = `${to}.${nanoid()}.partial`
  try {
    await fs.promises.copyFile(from, partial)
    await fs.promises.rename(partial, to)
  } finally {
    await fs.promises.rm(partial, { force: true })
  }
  await fs.promises.rm(from, { force: true })
}

/**
 * Moves every file in one folder into another, keeping their places inside it, and removes the folders left empty. A
 * file already at its destination is left where it was. Returns how many were moved
 */
export async function moveFolderContents(from: string, to: string) {
  let moved = 0
  const [, found] = await attemptAsync(() => fs.promises.readdir(from, { recursive: true, withFileTypes: true }))
  const entries = found ?? []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const source = path.join(entry.parentPath, entry.name)
    const destination = path.join(to, path.relative(from, source))
    if (fs.existsSync(destination)) {
      continue
    }
    await moveFile(source, destination)
    moved += 1
  }
  // Deepest first, so a folder is empty by the time it's reached; one that still holds a file is kept
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted((a, b) => b.length - a.length)
  for (const folder of [...folders, from]) {
    await attemptAsync(() => fs.promises.rmdir(folder))
  }
  return moved
}
