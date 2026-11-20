// Builds the game info database the app looks games up in (src/utils/server/game-info), from libretro's database
// (database-rdb.zip) and LaunchBox's (Metadata.zip). Adapted from msleuth's builder, by arianrhodsandlot (MIT).
//
//   node scripts/game-info.ts <database-rdb.zip> <Metadata.zip> [output, default game-info/game-info.sqlite]
//
// Only the consoles the app has are kept. libretro's games get the same IDs msleuth gave them, so games matched before
// still find their info
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { camelCase } from 'es-toolkit'
import { Libretrodb } from 'libretrodb'
import sax from 'sax'
import { getCompactName, getGoodcodesBaseCompactName } from './game-info/names.ts'
import { launchboxPlatformNames, libretroPlatformNames } from './game-info/platforms.ts'
import { gameInfoIndexes, gameInfoTables } from './game-info/tables.ts'

type Value = null | number | string

function snakeCase(column: string) {
  return column.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)
}

function insert(db: DatabaseSync, table: string, columns: string[]) {
  const statement = db.prepare(
    `INSERT OR IGNORE INTO ${table} (${columns.map((column) => snakeCase(column)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  )
  return (row: Record<string, unknown>) => statement.run(...columns.map((column) => (row[column] ?? null) as Value))
}

function text(value: unknown) {
  return value === undefined || value === null ? null : `${value}`
}

// As msleuth read them: a number, or nothing for none or zero
function integer(value: unknown) {
  return Math.trunc(Number(value)) || null
}

function decimal(value: unknown) {
  return Number(value) || null
}

function boolean(value: unknown) {
  if (value === 'true') {
    return 1
  }
  if (value === 'false') {
    return 0
  }
  return null
}

function timestamp(value: unknown) {
  if (!value) {
    return null
  }
  const time = new Date(`${value}`).getTime()
  return Number.isNaN(time) ? null : time
}

const libretroColumns = [
  'compactName',
  'crc',
  'description',
  'developer',
  'esrbRating',
  'franchise',
  'genre',
  'goodcodesBaseCompactName',
  'id',
  'md5',
  'name',
  'origin',
  'platform',
  'publisher',
  'releasemonth',
  'releaseyear',
  'romName',
  'sha1',
  'size',
  'users',
]

async function addLibretro(db: DatabaseSync, directory: string) {
  const add = insert(db, 'libretro_games', libretroColumns)
  let count = 0
  for (const platform of [...libretroPlatformNames].toSorted()) {
    const file = path.join(directory, `${platform}.rdb`)
    const libretrodb = await Libretrodb.from(file, { indexHashes: false })
    for (const record of libretrodb.getEntries() as Record<string, unknown>[]) {
      if (!record.name) {
        continue
      }
      const row: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        row[camelCase(key)] = value
      }
      add({
        ...row,
        compactName: getCompactName(`${record.name}`),
        goodcodesBaseCompactName: getGoodcodesBaseCompactName(`${record.name}`),
        // The ID msleuth gave it, so a game's stored ID still finds it
        id: crypto.hash('sha1', JSON.stringify({ ...record, platform })),
        platform,
        releasemonth: integer(row.releasemonth),
        releaseyear: integer(row.releaseyear),
        size: integer(row.size),
        users: integer(row.users),
        ...Object.fromEntries(
          [
            'crc',
            'description',
            'developer',
            'esrbRating',
            'franchise',
            'genre',
            'md5',
            'name',
            'origin',
            'publisher',
            'romName',
            'sha1',
          ].map((column) => [column, text(row[column])]),
        ),
      })
      count += 1
    }
  }
  return count
}

const launchboxColumns = [
  'communityRating',
  'communityRatingCount',
  'compactName',
  'cooperative',
  'databaseId',
  'developer',
  'dos',
  'esrb',
  'genres',
  'goodcodesBaseCompactName',
  'maxPlayers',
  'name',
  'overview',
  'platform',
  'publisher',
  'releaseDate',
  'releaseType',
  'releaseYear',
  'setupFile',
  'setupMd5',
  'startupFile',
  'startupMd5',
  'startupParameters',
  'steamAppId',
  'videoUrl',
  'wikipediaUrl',
]

// The pictures that can stand for a game's box, best first: its front cover, one rebuilt from scans, one made by a fan,
// then the cartridge
const coverTypes = ['Box - Front', 'Box - Front - Reconstructed', 'Fanart - Box - Front', 'Cart - Front']
// Among pictures of the same kind, the one for these regions first, then one for no region, then any other
const coverRegions = ['North America', 'United States', 'World', '', 'Europe', 'Japan']

function coverRank({ region = '', type = '' }: Record<string, string>) {
  const regionRank = coverRegions.indexOf(region)
  return coverTypes.indexOf(type) * 100 + (regionRank === -1 ? coverRegions.length : regionRank)
}

// Reads LaunchBox's Metadata.xml a piece at a time (it's over 500 MB): its <Game> and <GameAlternateName> records,
// each a list of fields, as msleuth read them, and the best front cover among its <GameImage> records
function addLaunchbox(db: DatabaseSync, file: string) {
  const addGame = insert(db, 'launchbox_games', launchboxColumns)
  const addAlternate = insert(db, 'launchbox_game_alternate_names', [
    'alternateName',
    'compactName',
    'databaseId',
    'region',
  ])
  const addCover = insert(db, 'launchbox_covers', ['databaseId', 'fileName'])
  const gameIds = new Set<string>()
  const alternates: Record<string, string>[] = []
  const covers = new Map<string, Record<string, string>>()
  let games = 0

  const { promise, reject, resolve } = Promise.withResolvers<undefined>()
  const tags: string[] = []
  let record: Record<string, string> = {}
  let field = ''
  let recording = false
  const parser = sax.createStream(true, { trim: true })
  parser.on('opentag', (tag) => {
    tags.push(tag.name)
    field = camelCase(tag.name)
    recording = tags.length > 2 && ['Game', 'GameAlternateName', 'GameImage'].includes(tags[1])
  })
  parser.on('text', (value) => {
    if (recording && field) {
      record[field] = (record[field] || '') + value
    }
  })
  parser.on('closetag', () => {
    const tag = tags.pop()
    if (tags.length === 1) {
      if (tag === 'Game' && record.platform && launchboxPlatformNames.has(record.platform) && record.name) {
        gameIds.add(record.databaseId)
        addGame({
          ...record,
          communityRating: decimal(record.communityRating),
          communityRatingCount: integer(record.communityRatingCount),
          compactName: getCompactName(record.name),
          cooperative: boolean(record.cooperative),
          databaseId: integer(record.databaseId),
          goodcodesBaseCompactName: getGoodcodesBaseCompactName(record.name),
          maxPlayers: integer(record.maxPlayers),
          releaseDate: timestamp(record.releaseDate),
        })
        games += 1
      } else if (tag === 'GameAlternateName') {
        alternates.push(record)
      } else if (tag === 'GameImage' && coverTypes.includes(record.type) && record.databaseId && record.fileName) {
        const best = covers.get(record.databaseId)
        if (!best || coverRank(record) < coverRank(best)) {
          covers.set(record.databaseId, record)
        }
      }
      record = {}
      field = ''
    }
  })
  parser.on('end', () => resolve(undefined))
  parser.on('error', reject)
  createReadStream(file).pipe(parser)

  return promise.then(() => {
    let kept = 0
    for (const alternate of alternates) {
      const compactName = alternate.alternateName ? getCompactName(alternate.alternateName) : ''
      if (compactName && gameIds.has(alternate.databaseId)) {
        addAlternate({ ...alternate, compactName, databaseId: integer(alternate.databaseId) })
        kept += 1
      }
    }
    let coverCount = 0
    for (const [databaseId, cover] of covers) {
      if (gameIds.has(databaseId)) {
        addCover({ databaseId: integer(databaseId), fileName: cover.fileName })
        coverCount += 1
      }
    }
    return { alternates: kept, covers: coverCount, games }
  })
}

async function build(rdbZip: string, metadataZip: string, output: string) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'game-info-'))
  try {
    for (const [zip, into] of [
      [rdbZip, 'libretro'],
      [metadataZip, 'launchbox'],
    ]) {
      await fs.mkdir(path.join(work, into))
      execFileSync('bsdtar', ['-xf', path.resolve(zip), '-C', path.join(work, into)], { stdio: 'inherit' })
    }
    const rdbDirectory = path.join(work, 'libretro')
    const [rdbFolder] = await fs.readdir(rdbDirectory)
    const rdbFolderStat = await fs.stat(path.join(rdbDirectory, rdbFolder))
    const rdbs = rdbFolderStat.isDirectory() ? path.join(rdbDirectory, rdbFolder) : rdbDirectory

    const partial = `${output}.partial`
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.rm(partial, { force: true })
    const db = new DatabaseSync(partial)
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;')
    db.exec(gameInfoTables)
    db.exec('BEGIN')
    const libretro = await addLibretro(db, rdbs)
    const launchbox = await addLaunchbox(db, path.join(work, 'launchbox', 'Metadata.xml'))
    db.exec('COMMIT')
    db.exec(gameInfoIndexes)
    db.exec('VACUUM')
    db.close()
    await fs.rename(partial, output)
    const { size } = await fs.stat(output)
    console.info(
      `Game info: ${libretro} libretro entries, ${launchbox.games} LaunchBox games, ${launchbox.alternates} other names and ${launchbox.covers} covers; ${(size / 1024 / 1024).toFixed(1)} MB at ${output}`,
    )
  } finally {
    await fs.rm(work, { force: true, recursive: true })
  }
}

const [rdbZip, metadataZip, output = path.join('game-info', 'game-info.sqlite')] = process.argv.slice(2)
if (!rdbZip || !metadataZip) {
  console.error('Usage: node scripts/game-info.ts <database-rdb.zip> <Metadata.zip> [output]')
  process.exit(1)
}
await build(rdbZip, metadataZip, path.resolve(output))
