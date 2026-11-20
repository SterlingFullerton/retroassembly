import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { and, eq, inArray, or } from 'drizzle-orm'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { getRunTimeEnv } from '#@/constants/env.ts'
import {
  getCompactName,
  getCountries,
  getGoodcodesBase,
  getGoodcodesBaseCompactName,
  restoreTitleForSorting,
} from './names.ts'
import { gameInfoPlatforms } from './platforms.ts'
import * as schema from './schema.ts'
import type { LibretroGame } from './schema.ts'

// Finds a game's info (name, year, developer, players, genres, description) in the game info database, which is built
// with the app from LaunchBox's and libretro's own databases (scripts/game-info.ts), so no lookup leaves the server.
// The matching is msleuth's, by arianrhodsandlot (MIT), run here instead of on its server

const { launchboxGameAlternateNameTable, launchboxGameTable, libretroGameTable } = schema
type DB = BetterSQLite3Database<typeof schema>
type Platform = keyof typeof gameInfoPlatforms

export interface GameFile {
  md5?: string
  name: string
}

export function getGameInfoDatabasePath() {
  return path.resolve(getRunTimeEnv().RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE)
}

let database: DB | null | undefined
function getDB() {
  if (database === undefined) {
    const file = getGameInfoDatabasePath()
    if (fs.existsSync(file)) {
      database = drizzle(new Database(file, { fileMustExist: true, readonly: true }), { casing: 'snake_case', schema })
    } else {
      console.warn(`No game info database at ${file}, so games are added without their info`)
      database = null
    }
  }
  return database
}

function isPlatform(platform: string): platform is Platform {
  return Object.hasOwn(gameInfoPlatforms, platform)
}

// Rows as they'd arrive as JSON, as they did from msleuth's server: dates as text, nothing undefined. A JSON round trip,
// not structuredClone, which would keep the dates
function plain<T>(value: T): T {
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the dates must become text
  return JSON.parse(JSON.stringify(value ?? null))
}

const libretroColumns = ['md5', 'romName', 'name', 'compactName', 'goodcodesBaseCompactName'] as const
type LibretroColumn = (typeof libretroColumns)[number]

function identifyLibretroByColumns({
  columns,
  db,
  files,
  platform,
}: Readonly<{ columns: readonly LibretroColumn[]; db: DB; files: GameFile[]; platform: Platform }>) {
  const extendedFiles = files.map((file) => {
    const { name } = path.parse(file.name || '')
    return {
      compactName: getCompactName(name),
      goodcodesBaseCompactName: getGoodcodesBaseCompactName(name),
      md5: file.md5,
      name,
      romName: file.name,
    }
  })
  const filters = columns
    .map((column) => ({
      column: libretroGameTable[column],
      values: extendedFiles.map((file) => file[column] || '').filter(Boolean),
    }))
    .filter(({ values }) => values.length > 0)
  if (filters.length === 0) {
    return files.map(() => null)
  }
  const rows = db
    .select()
    .from(libretroGameTable)
    .where(
      and(
        or(...filters.map(({ column, values }) => inArray(column, values))),
        inArray(libretroGameTable.platform, [...gameInfoPlatforms[platform].libretro]),
      ),
    )
    .all()
  return extendedFiles.map((file) => {
    for (const column of columns) {
      const row = pickLibretroRow(
        rows.filter((candidate) => candidate[column] === file[column]),
        file.romName,
      )
      if (row) {
        return row
      }
    }
    return null
  })
}

/**
 * The best of several entries for the same game. libretro lists bad dumps, hacks and translations beside each release,
 * as "Adventures of Lolo 3 (USA)[b2]", and betas, prototypes and re-releases in collections. So, in turn: a plain
 * release, one for the file's own region ("(U)" or "(USA)" in its name) and disc, an ordinary one, the revision the
 * file names ("(PRG1)", "(V1.1)") or none, then libretro's own order
 */
const unusualRelease =
  /\((?:Beta|Proto|Sample|Demo|Pirate|Aftermarket|Virtual Console|Evercade|Retro-Bit|Limited Run)\b|Collection\)/iu
const revision = /\((?:Rev\b|v1\.[1-9])/iu
const fileRevision = /\((?:PRG\s*0*[1-9]|REV\s*0*[1-9]|V1\.[1-9])/iu
function pickLibretroRow(rows: LibretroGame[], fileName: string) {
  if (rows.length < 2) {
    return rows[0]
  }
  const { name: baseName } = path.parse(fileName)
  const countries = getCountries(baseName)
  const wantsRevision = fileRevision.test(baseName)
  const disc = /\(Disc \d+\)/iu.exec(baseName)?.[0].toLowerCase()
  function rank(row: LibretroGame) {
    const name = row.name || ''
    const tagged = name.includes('[') ? 8 : 0
    const otherRegion = countries.length > 0 && !countries.some((country) => name.includes(country)) ? 4 : 0
    const otherDisc = disc && !name.toLowerCase().includes(disc) ? 4 : 0
    const unusual = unusualRelease.test(name) && !unusualRelease.test(baseName) ? 2 : 0
    const otherRevision = revision.test(name) === wantsRevision ? 0 : 1
    return tagged + otherRegion + otherDisc + unusual + otherRevision
  }
  return rows.reduce((best, row) => (rank(row) < rank(best) ? row : best))
}

// By the file's MD5 first; then by its name, exactly, then with only letters and digits, then without its tags
function identifyLibretro(db: DB, platform: Platform, files: GameFile[]) {
  const byMd5 = identifyLibretroByColumns({ columns: ['md5'], db, files, platform })
  if (byMd5.every(Boolean)) {
    return byMd5
  }
  const nameColumns = platform === 'arcade' ? (['romName'] as const) : libretroColumns.slice(1)
  const byName = identifyLibretroByColumns({ columns: nameColumns, db, files, platform })
  return files.map((_file, index) => byMd5[index] || byName[index])
}

// By name, with "Title, The" read as "The Title", and by the other names LaunchBox lists for its games
function identifyLaunchbox(db: DB, platform: Platform, files: GameFile[]) {
  const extendedFiles = files.map((file) => {
    const restoredBaseName = restoreTitleForSorting(getGoodcodesBase(path.parse(file.name || '').name))
    return {
      alternateDatabaseIds: [] as number[],
      compactName: getCompactName(restoredBaseName),
      goodcodesBaseCompactName: getGoodcodesBaseCompactName(restoredBaseName),
    }
  })
  if (extendedFiles.length === 0) {
    return []
  }
  const alternates = db
    .select()
    .from(launchboxGameAlternateNameTable)
    .where(
      inArray(
        launchboxGameAlternateNameTable.compactName,
        extendedFiles.map(({ compactName }) => compactName),
      ),
    )
    .all()
  for (const alternate of alternates) {
    for (const file of extendedFiles) {
      if (alternate.compactName === file.compactName && alternate.databaseId) {
        file.alternateDatabaseIds.push(alternate.databaseId)
      }
    }
  }

  const columns = ['compactName', 'goodcodesBaseCompactName'] as const
  const filters = [
    ...columns.map((column) => ({
      column: launchboxGameTable[column],
      values: extendedFiles.map((file) => file[column]).filter(Boolean) as (number | string)[],
    })),
    {
      column: launchboxGameTable.databaseId,
      values: extendedFiles.flatMap(({ alternateDatabaseIds }) => alternateDatabaseIds) as (number | string)[],
    },
  ].filter(({ values }) => values.length > 0)
  if (filters.length === 0) {
    return files.map(() => null)
  }
  const rows = db
    .select()
    .from(launchboxGameTable)
    .where(
      and(
        or(...filters.map(({ column, values }) => inArray(column, values))),
        eq(launchboxGameTable.platform, gameInfoPlatforms[platform].launchbox),
      ),
    )
    .all()
  return extendedFiles.map((file) => {
    for (const column of columns) {
      const row = rows.find((candidate) => candidate[column] === file[column])
      if (row) {
        return row
      }
      const alternateRow = rows.find(({ databaseId }) => file.alternateDatabaseIds.includes(databaseId))
      if (alternateRow) {
        return alternateRow
      }
    }
    return null
  })
}

/**
 * Each file's info from libretro's database and LaunchBox's. LaunchBox's is looked up by libretro's name for the game
 * when libretro knows it, since that name is the cleanest
 */
export function identifyGames({ files, platform }: Readonly<{ files: GameFile[]; platform: string }>) {
  const db = getDB()
  if (!db) {
    return
  }
  if (!isPlatform(platform)) {
    return files.map(() => ({ launchbox: null, libretro: null }))
  }
  const libretro = identifyLibretro(db, platform, files)
  const launchbox = identifyLaunchbox(
    db,
    platform,
    files.map((file, index) => ({
      ...file,
      name: libretro[index] ? `${libretro[index].name}${path.parse(file.name).ext}` : file.name,
    })),
  )
  return files.map((_file, index) => plain({ launchbox: launchbox[index], libretro: libretro[index] }))
}

/** The info stored for games matched before, by their LaunchBox and libretro IDs */
export function queryGames({
  conditions,
}: Readonly<{ conditions: { launchboxId?: null | number; libretroId?: null | string }[] }>) {
  const db = getDB()
  // Nothing rather than empty info, so games matched before keep waiting for their info instead of being given none
  if (!db) {
    return
  }
  const launchboxIds = conditions.map(({ launchboxId }) => launchboxId).filter((id): id is number => Boolean(id))
  const libretroIds = conditions.map(({ libretroId }) => libretroId).filter((id): id is string => Boolean(id))
  const launchboxRows = launchboxIds.length
    ? db.select().from(launchboxGameTable).where(inArray(launchboxGameTable.databaseId, launchboxIds)).all()
    : []
  const libretroRows = libretroIds.length
    ? db.select().from(libretroGameTable).where(inArray(libretroGameTable.id, libretroIds)).all()
    : []
  return conditions.map(({ launchboxId, libretroId }) =>
    plain({
      launchbox: launchboxRows.find((row) => row.databaseId === launchboxId),
      libretro: libretroRows.find((row) => row.id === libretroId),
    }),
  )
}
