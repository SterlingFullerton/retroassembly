import path from 'node:path'

// The settings the dev tools read, by their short names, each with its old name, which is still read when the short one
// isn't set (as server/internal/config does for the server)
const settingNames = {
  ARTWORK_DIR: 'RETROASSEMBLY_RUN_TIME_ARTWORK_DIRECTORY',
  BIOSES_DIR: 'RETROASSEMBLY_RUN_TIME_BIOSES_DIRECTORY',
  CACHE_DIR: 'RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY',
  CDN_CACHE: 'RETROASSEMBLY_RUN_TIME_CDN_CACHE',
  DATA_DIR: 'RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY',
  GAME_INFO_DB: 'RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE',
  PORT: 'RETROASSEMBLY_RUN_TIME_PORT',
  ROMS_DIR: 'RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY',
  SAVES_DIR: 'RETROASSEMBLY_RUN_TIME_GAME_SAVES_DIRECTORY',
  STATES_DIR: 'RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY',
  STORAGE_DIR: 'RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY',
} as const

/** A setting by its short name, or by its old name when the short one is unset or empty */
export function getSetting(name: keyof typeof settingNames) {
  return process.env[name] || process.env[settingNames[name]] || ''
}

/**
 * Each kind of stored file can have a folder of its own, such as the games on a large disk and the saves on a fast one.
 * A kind with no folder set is kept where it always was: in the storage folder, or the cache in the data folder
 */
export function getDirectories() {
  const dataDirectory = getSetting('DATA_DIR') || path.resolve('data')
  // Not inside the data folder when only that is set, as the server resolves the two separately
  const storageDirectory = getSetting('STORAGE_DIR') || path.resolve('data', 'storage')
  // Box art uploaded for a game, and libretro's covers, title screens and screenshots, when set (see getArtworkPath).
  // Unset, uploaded box art stays in the storage folder and libretro's art in the cache with the emulator files
  const artworkDirectory = getSetting('ARTWORK_DIR')
  return {
    artworkDirectory,
    attachmentsDirectory: artworkDirectory
      ? path.join(artworkDirectory, 'attachments')
      : path.join(storageDirectory, 'attachments'),
    biosesDirectory: getSetting('BIOSES_DIR') || path.join(storageDirectory, 'bioses'),
    cacheDirectory: getSetting('CACHE_DIR') || path.join(dataDirectory, 'cache'),
    dataDirectory,
    gameSavesDirectory: getSetting('SAVES_DIR') || path.join(storageDirectory, 'game-saves'),
    romsDirectory: getSetting('ROMS_DIR') || path.join(storageDirectory, 'roms'),
    statesDirectory: getSetting('STATES_DIR') || path.join(storageDirectory, 'states'),
    storageDirectory,
  }
}

export function getDatabasePath() {
  const { dataDirectory } = getDirectories()
  return path.join(dataDirectory, 'retroassembly.sqlite')
}
