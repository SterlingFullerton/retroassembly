import path from 'node:path'
import { getDirectories } from '#@/constants/env.ts'

/**
 * The path on disk of a stored file, or undefined if its id would reach outside the storage directory. Ids come from
 * request URLs, where "..%2F" arrives as "../", so an id like "../retroassembly.sqlite" must not be read or written.
 */
export function getStoragePath(storageDirectory: string, id: string) {
  const root = path.resolve(storageDirectory)
  const filePath = path.resolve(root, id)
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return
  }
  return filePath
}

// The kinds of stored file that can have a folder of their own, by the first part of their id, as in "roms/nes/<id>.nes"
const kindDirectories = {
  attachments: 'attachmentsDirectory',
  bioses: 'biosesDirectory',
  'game-saves': 'gameSavesDirectory',
  roms: 'romsDirectory',
  states: 'statesDirectory',
} as const

/**
 * The path on disk of a stored file: in its kind's folder ("roms/nes/<id>.nes" is "nes/<id>.nes" in the games folder),
 * or in the storage folder for anything else. Undefined if the id would reach outside that folder. Ids stay as they
 * are wherever the folders are, so moving a kind to another folder never changes the database
 */
export function getFilePath(id: string, directories = getDirectories()) {
  const [kind, ...rest] = path.posix.normalize(id).split('/')
  const setting = kindDirectories[kind as keyof typeof kindDirectories]
  if (setting && rest.length > 0) {
    return getStoragePath(directories[setting], rest.join('/'))
  }
  return getStoragePath(directories.storageDirectory, id)
}
