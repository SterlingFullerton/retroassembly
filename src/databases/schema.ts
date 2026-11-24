import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { customAlphabet } from 'nanoid'
import { nolookalikes } from 'nanoid-dictionary'
import type { PlatformName } from '#@/constants/platform.ts'
import type { PreferenceSnippet } from '../constants/preference.ts'

// The ids the app gives its rows: 10 characters that can't be mistaken for one another, as the Go server makes them
const nanoid = customAlphabet(nolookalikes, 10)

export const statusEnum = {
  deleted: 0,
  normal: 1,
}

export const libraryModeEnum = {
  isolated: 0,
  shared: 1,
}

// What an account may do in the server's one library: a player plays; a contributor also adds and edits games; an
// admin also deletes them and manages the accounts. `user` is what there was before, which reads as player
export const roleEnum = {
  admin: 'admin',
  contributor: 'contributor',
  player: 'player',
  user: 'user',
} as const

export const authenticationMethodEnum = {
  oidc: 'oidc',
  password: 'password',
} as const

const baseSchema = {
  createdAt: integer({ mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  id: text('id').primaryKey().notNull().$defaultFn(nanoid),
  status: integer().notNull().default(statusEnum.normal),
  updatedAt: integer({ mode: 'timestamp_ms' })
    .notNull()
    .$onUpdateFn(() => new Date()),
}

const fileSchema = {
  ...baseSchema,
  fileId: text().notNull(),
  userId: text().notNull(),
}

export const userTable = sqliteTable(
  'users',
  {
    libraryMode: integer().notNull().default(libraryModeEnum.isolated),
    passwordHash: text(),
    registrationIp: text(),
    registrationUserAgent: text(),
    role: text({ enum: [roleEnum.admin, roleEnum.contributor, roleEnum.player, roleEnum.user] })
      .notNull()
      .default(roleEnum.user),
    username: text().notNull(),
    ...baseSchema,
  },
  (table) => [index('idx_users_username').on(table.username)],
)

export const sessionTable = sqliteTable(
  'sessions',
  {
    authenticationMethod: text({ enum: [authenticationMethodEnum.password, authenticationMethodEnum.oidc] })
      .notNull()
      .default(authenticationMethodEnum.password),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ip: text(),
    lastActivityAt: integer({ mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    token: text().notNull().unique(),
    userAgent: text(),
    userId: text().notNull(),
    ...baseSchema,
  },
  (table) => [index('idx_sessions_user').on(table.userId, table.status)],
)

export const oidcIdentityTable = sqliteTable(
  'oidc_identities',
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    userId: text().notNull(),
    ...baseSchema,
  },
  (table) => [
    uniqueIndex('idx_oidc_identities_issuer_subject').on(table.issuer, table.subject),
    uniqueIndex('idx_oidc_identities_user').on(table.userId),
  ],
)
export const romTable = sqliteTable(
  'roms',
  {
    // A game on several discs is listed once: its discs share a group, and the lowest-numbered one stands for the game
    discGroup: text(),
    discNumber: integer(),
    fileName: text().notNull(),
    gameBoxartFileIds: text(),
    gameDescription: text(),
    gameDeveloper: text(),
    gameGenres: text(),
    gameName: text(),
    gamePlayers: integer(),
    gamePublisher: text(),
    gameRating: integer(),
    gameReleaseDate: integer({ mode: 'timestamp_ms' }),
    /** deprecated. use gameReleaseDate instead */
    gameReleaseYear: integer(),
    gameThumbnailFileIds: text(),
    /** The name the player gave the game, shown in place of the title from its file name */
    gameTitle: text(),
    launchboxGameId: integer(),
    libretroGameId: text(),
    platform: text().notNull().$type<PlatformName>(),
    rawGameMetadata: text({ mode: 'json' }).$type<{
      launchbox?: any
      libretro?: any
    }>(),
    ...fileSchema,
  },
  (table) => [
    index('idx_roms_user_status_platform').on(table.userId, table.status, table.platform),
    index('idx_roms_user_status_created').on(table.userId, table.status, table.createdAt),
    index('idx_roms_user_status_released').on(table.userId, table.status, table.gameReleaseDate),
    index('idx_roms_user_status_name').on(table.userId, table.status, table.fileName),
    // For delete-roms.ts: find still-referenced files during cleanup
    index('idx_roms_file_status').on(table.fileId, table.status),
    // For get-rom.ts: lookup ROM by filename when ID not provided
    index('idx_roms_user_platform_filename').on(table.userId, table.platform, table.fileName),
    index('idx_roms_user_platform_disc_group').on(table.userId, table.platform, table.discGroup),
    // Search reads every game's names: from here, rather than from rows that also hold kilobytes of game info. The disc
    // group comes right after the console, so finding a game's other discs, as every list does, can use it too: before
    // the names, it would be the slowest index for that, and the one SQLite picks
    index('idx_roms_search').on(
      table.userId,
      table.status,
      table.platform,
      table.discGroup,
      table.fileName,
      table.gameName,
      table.gameTitle,
      table.gameDeveloper,
      table.gamePublisher,
      table.id,
    ),
    // Home's picks of well-rated games filter on LaunchBox's rating and how many gave one, which are in each game's
    // stored LaunchBox data: kept here, they're read without opening it. The expressions are the server's own
    // (server/internal/library/lists.go), as an index on an expression is used only for that exact expression
    index('idx_roms_rating').on(
      table.userId,
      table.status,
      sql`coalesce(json_extract(raw_game_metadata, '$.launchbox.communityRatingCount'), 0)`,
      sql`coalesce(json_extract(raw_game_metadata, '$.launchbox.communityRating'), 0)`,
      table.platform,
      table.discGroup,
      table.gamePlayers,
      table.id,
    ),
    // A game list sorted by name or by popularity reads its page straight from one of these, in order, rather than
    // sorting every game for each page. One pair is for the lists of every console, one for a single console's. The
    // expressions are the server's own (server/internal/library/gamelist.go), as idx_roms_rating's are
    index('idx_roms_name').on(
      table.userId,
      table.status,
      sql`lower(file_name)`,
      table.id,
      table.platform,
      table.discGroup,
    ),
    index('idx_roms_name_platform').on(
      table.userId,
      table.status,
      table.platform,
      sql`lower(file_name)`,
      table.id,
      table.discGroup,
    ),
    index('idx_roms_popular').on(
      table.userId,
      table.status,
      sql`CASE WHEN json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') > 0 THEN (json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') * json_extract(raw_game_metadata, '$.launchbox.communityRating') + 350.0) / (json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') + 100) END DESC`,
      sql`lower(file_name)`,
      table.id,
      table.platform,
      table.discGroup,
    ),
    index('idx_roms_popular_platform').on(
      table.userId,
      table.status,
      table.platform,
      sql`CASE WHEN json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') > 0 THEN (json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') * json_extract(raw_game_metadata, '$.launchbox.communityRating') + 350.0) / (json_extract(raw_game_metadata, '$.launchbox.communityRatingCount') + 100) END DESC`,
      sql`lower(file_name)`,
      table.id,
      table.discGroup,
    ),
  ],
)

export const stateTable = sqliteTable(
  'states',
  {
    // An id the browser gives a save, so a save uploaded again after a dropped connection is stored only once
    clientId: text(),
    core: text().notNull(),
    // The disc in the drive when it was saved, for a game on several discs
    disc: integer(),
    platform: text().notNull(),
    romId: text().notNull(),
    thumbnailFileId: text().notNull(),
    type: text({ enum: ['auto', 'manual'] }).notNull(),
    ...fileSchema,
  },
  (table) => [
    index('idx_states_rom_status').on(table.romId, table.status, table.createdAt),
    index('idx_states_user_status').on(table.userId, table.status),
    // For get-states.ts: filter states by romId + type (manual/auto)
    index('idx_states_user_rom_status_type').on(table.userId, table.romId, table.status, table.type),
    uniqueIndex('idx_states_user_client_id').on(table.userId, table.clientId),
  ],
)

// A game's own save (a memory card or a cartridge's battery save), as the emulator writes it, kept per player, game and
// emulator. Each upload is a version; the latest few are kept
export const gameSaveTable = sqliteTable(
  'game_saves',
  {
    // An id the browser gives an upload, so one sent again after a dropped connection is stored only once
    clientId: text(),
    core: text().notNull(),
    platform: text().notNull(),
    romId: text().notNull(),
    // The save's SHA-1, so an unchanged save isn't stored again
    sha1: text().notNull(),
    size: integer().notNull(),
    ...fileSchema,
  },
  (table) => [
    index('idx_game_saves_user_rom_core').on(table.userId, table.romId, table.core, table.status, table.createdAt),
    uniqueIndex('idx_game_saves_user_client_id').on(table.userId, table.clientId),
  ],
)

export const launchRecordTable = sqliteTable(
  'launch_records',
  {
    core: text().notNull(),
    platform: text().notNull(),
    romId: text().notNull(),
    userId: text().notNull(),
    ...baseSchema,
  },
  (table) => [
    index('idx_launch_records_user_status_platform').on(table.userId, table.status, table.platform, table.createdAt),
  ],
)

export const userPreferenceTable = sqliteTable(
  'user_preferences',
  {
    emulator: text({ mode: 'json' }).$type<PreferenceSnippet['emulator']>(),
    input: text({ mode: 'json' }).$type<PreferenceSnippet['input']>(),
    ui: text({ mode: 'json' }).$type<PreferenceSnippet['ui']>(),
    user: text({ mode: 'json' }),
    userId: text().notNull(),
    ...baseSchema,
  },
  (table) => [index('idx_user_preferences').on(table.userId)],
)

export const favoriteTable = sqliteTable(
  'favorites',
  {
    romId: text().notNull(),
    userId: text().notNull(),
    ...baseSchema,
  },
  (table) => [
    uniqueIndex('idx_favorites_user_rom').on(table.userId, table.romId),
    index('idx_favorites_user_status_created').on(table.userId, table.status, table.createdAt),
    // For remove-favorite.ts: soft-delete favorite with status check
    index('idx_favorites_user_rom_status').on(table.userId, table.romId, table.status),
  ],
)
