import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs-extra'
import isDocker from 'is-docker'
import { directorySettings, getDirectories, getRunTimeEnv } from '../../../constants/env.ts'
import { updateDiscGroups } from '../disc-groups.ts'
import { getDatabase } from '../drizzle.ts'
import { moveFolderContents } from '../move-file.ts'

async function testDataDirectory() {
  const { dataDirectory } = getDirectories()
  const dataDirectoryExists = await fs.exists(dataDirectory)
  if (dataDirectoryExists) {
    return
  }

  const errorMessages = [`Data directory ${dataDirectory} does not exist.`]
  if (isDocker()) {
    errorMessages.push(
      `As you are using Docker, make sure to mount the data directory with "--volume <data_directory_path>:${dataDirectory}".`,
    )
  }
  for (const errorMessage of errorMessages) {
    console.error(errorMessage)
  }
  const errorMessage = errorMessages.join('\n')
  throw new Error(errorMessage)
}

/**
 * Each folder set for a kind of file must be there and writable, as a missing mount would otherwise only show up when a
 * game, save or snapshot fails to load or save
 */
async function testFileDirectories() {
  const runTimeEnv = getRunTimeEnv()
  const directories = getDirectories()
  const errorMessages: string[] = []
  for (const [key, setting] of Object.entries(directorySettings)) {
    if (!runTimeEnv[setting]) {
      continue
    }
    const directory = directories[key as keyof typeof directorySettings]
    if (!(await fs.exists(directory))) {
      errorMessages.push(`${setting} is set to ${directory}, which does not exist.`)
      continue
    }
    try {
      await fs.access(directory, fs.constants.W_OK)
    } catch {
      errorMessages.push(`${setting} is set to ${directory}, which can't be written to.`)
    }
  }
  if (errorMessages.length > 0) {
    if (isDocker()) {
      errorMessages.push('As you are using Docker, make sure each of these folders is mounted, and not read-only.')
    }
    for (const errorMessage of errorMessages) {
      console.error(errorMessage)
    }
    throw new Error(errorMessages.join('\n'))
  }
}

/**
 * Box art uploaded before an artwork folder was set is moved into it, once: the first time the server starts with the
 * setting. Its ids stay the same, so nothing in the database changes
 */
async function moveUploadedArtwork() {
  const { artworkDirectory, attachmentsDirectory, storageDirectory } = getDirectories()
  if (artworkDirectory && getRunTimeEnv().RETROASSEMBLY_RUN_TIME_CDN_CACHE !== 'true') {
    console.warn(
      'RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY holds only uploaded box art unless RETROASSEMBLY_RUN_TIME_CDN_CACHE=true: libretro art is otherwise loaded by the browser straight from libretro',
    )
  }
  const previous = path.join(storageDirectory, 'attachments')
  if (
    !artworkDirectory ||
    path.resolve(previous) === path.resolve(attachmentsDirectory) ||
    !(await fs.exists(previous))
  ) {
    return
  }
  const moved = await moveFolderContents(previous, attachmentsDirectory)
  console.info(`Moved ${moved} uploaded box art files into the artwork folder`)
}

function migrateDatabase() {
  const db = getDatabase().library
  migrate(db, {
    migrationsFolder: 'src/databases/migrations',
    migrationsSchema: 'src/databases/schema.ts',
  })
}

// Run before the server starts: checks the data directory and any folders set for files are there, and brings the
// database up to date
export async function initializeDatabase() {
  await testDataDirectory()
  await testFileDirectories()
  await moveUploadedArtwork()
  migrateDatabase()
  updateDiscGroups(getDatabase().library)
}
