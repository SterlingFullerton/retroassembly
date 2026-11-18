import path from 'node:path'
import { defaults } from 'es-toolkit/compat'

export function getRunTimeEnv() {
  const runTimeEnv = process.env

  return defaults(
    { ...runTimeEnv },
    {
      RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY: path.resolve('data'),
      RETROASSEMBLY_RUN_TIME_MAX_AUTO_STATES_PER_ROM: '20',
      RETROASSEMBLY_RUN_TIME_MAX_ROM_COUNT: '',
      RETROASSEMBLY_RUN_TIME_MAX_UPLOAD_AT_ONCE: '1000',
      RETROASSEMBLY_RUN_TIME_MSLEUTH_FALLBACK_HOST: 'https://msleuth.fly.dev/',
      RETROASSEMBLY_RUN_TIME_MSLEUTH_HOST: 'https://msleuth.arianrhodsandlot.workers.dev/',
      RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_ID: '',
      RETROASSEMBLY_RUN_TIME_OIDC_CLIENT_SECRET: '',
      RETROASSEMBLY_RUN_TIME_OIDC_ISSUER: '',
      RETROASSEMBLY_RUN_TIME_OIDC_REDIRECT_URI: '',
      RETROASSEMBLY_RUN_TIME_OIDC_REQUIRED_ROLE: '',
      RETROASSEMBLY_RUN_TIME_OIDC_SCOPES: 'openid profile email',
      RETROASSEMBLY_RUN_TIME_OIDC_SESSION_MAX_AGE: '28800000',
      RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY: path.resolve('data', 'storage'),
      RETROASSEMBLY_RUN_TIME_STORAGE_HOST: '',
    },
  )
}

/**
 * Each kind of stored file can have a folder of its own, such as the games on a large disk and the saves on a fast one.
 * A kind with no folder set is kept where it always was: in the storage folder, or the cache in the data folder
 */
export const directorySettings = {
  biosesDirectory: 'RETROASSEMBLY_RUN_TIME_BIOSES_DIRECTORY',
  cacheDirectory: 'RETROASSEMBLY_RUN_TIME_CACHE_DIRECTORY',
  gameSavesDirectory: 'RETROASSEMBLY_RUN_TIME_GAME_SAVES_DIRECTORY',
  romsDirectory: 'RETROASSEMBLY_RUN_TIME_ROMS_DIRECTORY',
  statesDirectory: 'RETROASSEMBLY_RUN_TIME_STATES_DIRECTORY',
} as const

export function getDirectories() {
  const runTimeEnv = getRunTimeEnv()
  const dataDirectory = runTimeEnv.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY
  const storageDirectory = runTimeEnv.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY
  function own(setting: keyof typeof directorySettings, fallback: string) {
    return runTimeEnv[directorySettings[setting]] || fallback
  }
  return {
    biosesDirectory: own('biosesDirectory', path.join(storageDirectory, 'bioses')),
    cacheDirectory: own('cacheDirectory', path.join(dataDirectory, 'cache')),
    dataDirectory,
    gameSavesDirectory: own('gameSavesDirectory', path.join(storageDirectory, 'game-saves')),
    romsDirectory: own('romsDirectory', path.join(storageDirectory, 'roms')),
    statesDirectory: own('statesDirectory', path.join(storageDirectory, 'states')),
    storageDirectory,
  }
}

export function getDatabasePath() {
  const { dataDirectory } = getDirectories()
  return path.join(dataDirectory, 'retroassembly.sqlite')
}
