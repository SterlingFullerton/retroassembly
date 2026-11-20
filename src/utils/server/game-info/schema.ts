import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The game info database's tables, built by scripts/game-info.ts from LaunchBox's and libretro's own databases. Adapted
// from msleuth by arianrhodsandlot (MIT): the same tables and columns, so a game's info has the same shape as before

export const launchboxGameTable = sqliteTable(
  'launchbox_games',
  {
    communityRating: real(),
    communityRatingCount: integer(),
    compactName: text().notNull(),
    cooperative: integer({ mode: 'boolean' }),
    databaseId: integer().primaryKey().notNull(),
    developer: text(),
    dos: text(),
    esrb: text(),
    genres: text(),
    goodcodesBaseCompactName: text().notNull(),
    maxPlayers: integer(),
    name: text().notNull(),
    overview: text(),
    platform: text(),
    publisher: text(),
    releaseDate: integer({ mode: 'timestamp_ms' }),
    releaseType: text(),
    releaseYear: text(),
    setupFile: text(),
    setupMd5: text(),
    startupFile: text(),
    startupMd5: text(),
    startupParameters: text(),
    steamAppId: text(),
    videoUrl: text(),
    wikipediaUrl: text(),
  },
  (table) => [
    index('idx_launchbox_games_compact_name').on(table.compactName),
    index('idx_launchbox_games_goodcodes_compact_name').on(table.goodcodesBaseCompactName),
  ],
)

export const launchboxGameAlternateNameTable = sqliteTable(
  'launchbox_game_alternate_names',
  {
    alternateName: text(),
    compactName: text(),
    databaseId: integer(),
    id: integer().primaryKey(),
    region: text(),
  },
  (table) => [index('idx_launchbox_game_alternate_name_compact_name').on(table.compactName)],
)

export const libretroGameTable = sqliteTable(
  'libretro_games',
  {
    compactName: text().notNull(),
    crc: text(),
    description: text(),
    developer: text(),
    esrbRating: text(),
    franchise: text(),
    genre: text(),
    goodcodesBaseCompactName: text().notNull(),
    id: text().primaryKey().notNull(),
    md5: text(),
    name: text(),
    origin: text(),
    platform: text(),
    publisher: text(),
    releasemonth: integer(),
    releaseyear: integer(),
    romName: text(),
    sha1: text(),
    size: integer(),
    users: integer(),
  },
  (table) => [
    index('idx_libretro_games_md5').on(table.md5),
    index('idx_libretro_games_rom_name').on(table.romName),
    index('idx_libretro_games_name').on(table.name),
    index('idx_libretro_games_compact_name').on(table.compactName),
    index('idx_libretro_games_goodcodes_base_compact_name').on(table.goodcodesBaseCompactName),
  ],
)

export type LaunchboxGame = typeof launchboxGameTable.$inferSelect
export type LibretroGame = typeof libretroGameTable.$inferSelect
