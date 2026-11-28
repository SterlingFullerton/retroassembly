// What the server's API sends and takes, as the browser has it: loaded as JSON, so its dates are strings. The rows come
// from the database schema (src/databases/schema.ts), which the server's own tables follow
import type { PlatformName } from '#@/constants/platform.ts'
import type { ResolvedPreference } from '#@/constants/preference.ts'
import type {
  favoriteTable,
  gameSaveTable,
  launchRecordTable,
  romTable,
  sessionTable,
  stateTable,
} from '#@/databases/schema.ts'

/** A value as it arrives as JSON: dates as text */
export type Json<T> = T extends Date
  ? string
  : T extends (infer Item)[]
    ? Json<Item>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T

export type RomRow = Json<typeof romTable.$inferSelect>
export type State = Json<typeof stateTable.$inferSelect>
export type GameSave = Json<typeof gameSaveTable.$inferSelect>
export type Favorite = Json<typeof favoriteTable.$inferSelect>
export type LaunchRecord = Json<typeof launchRecordTable.$inferSelect>
export type Session = Json<typeof sessionTable.$inferSelect>
export type Preference = Json<ResolvedPreference>

export type Role = 'admin' | 'contributor' | 'player'

/** A user, as the server names them */
export interface User {
  id: string
  libraryMode: number
  /** A player plays; a contributor also adds and edits games; an admin also deletes them and manages the accounts */
  role: Role
  username: string
}

/** An account, as the admins see it */
export interface Account extends User {
  createdAt: string
  /** The library's owner: the oldest admin, who can't be deleted or made an ordinary user */
  isSuper: boolean
  lastActivityAt: null | string
}

/** A device the user is signed in on */
export interface SignedInDevice {
  createdAt: string
  /** The one asking */
  current: boolean
  id: string
  ip: null | string
  lastActivityAt: string
  userAgent: null | string
}

/** A game in a list: its row, how many discs it's on, and whether the player likes it */
export type Rom = RomRow & { discCount: number; isFavorite: boolean }

/** A game in a list of picks or a search */
export type PickedRom = RomRow & { discCount: number; isFavorite: boolean }

/** A game in the play history */
export interface PlayedRom {
  core: string
  count: number
  discCount: number
  fileId: null | string
  fileName: null | string
  gameBoxartFileIds: null | string
  gameName: null | string
  gameTitle: null | string
  id: string
  isFavorite: boolean
  lastLaunched: null | string
  launchboxGameId: null | number
  libretroGameId: null | string
  platform: string
  rawGameMetadata: RomRow['rawGameMetadata'] | null
}

/** A game with saves, for Home's "Continue" */
export interface SavedRom {
  createdAt: string
  discCount: number
  fileId: string
  fileName: string
  gameBoxartFileIds: null | string
  gameName: null | string
  gameTitle: null | string
  id: string
  isFavorite: boolean
  lastSaved: null | string
  launchboxGameId: null | number
  libretroGameId: null | string
  platform: PlatformName
  rawGameMetadata: RomRow['rawGameMetadata']
}

export interface Pagination {
  current: number
  pages: number
  size: number
  total: number
}

export const romLetters = ['#', ...'abcdefghijklmnopqrstuvwxyz'] as const
export type RomLetter = (typeof romLetters)[number]

/** Where a letter's games start, in a list sorted by name */
export interface RomLetterPage {
  /** Whether any game starts with it */
  has: boolean
  letter: RomLetter
  /** The page its first game is on */
  page: number
}

export interface Disc {
  fileId: string
  fileName: string
  id: string
  number: number
}

/** A list of games, with a search's query when it's a search */
export interface RomList {
  letters: RomLetterPage[] | undefined
  pagination: Pagination
  roms: Rom[]
  search: { query: string; searched: number } | undefined
}

/** What every page shares */
export interface CommonPageData {
  authMode: 'local' | 'oidc'
  cdnCache: boolean
  currentUser: User
  detectedLanguage: string
  env: {
    MAX_AUTO_STATES: string
    MAX_ROMS: string
    MAX_UPLOAD: string
  }
  isLikelyDesktop: boolean
  language: string
  preference: Preference
  title: string
}

export type LoginPageData =
  | { error: { message: string } | null; formType: 'oidc'; redirectTo: string; title: string }
  | {
      error: null
      formType: 'login' | 'register'
      redirectTo: string
      /** Whether anyone can create an account (OPEN_SIGNUP), not only the first */
      signupOpen: boolean
      title: string
    }
  | { redirect: string }

export interface LibraryLayoutData {
  isAdmin: boolean
  recentlyLaunchedRoms: PlayedRom[]
}

export interface HomePageData {
  discs: Disc[]
  gameSave: GameSave | undefined
  heroReason: 'added' | 'played' | 'saved'
  inProgressRoms: SavedRom[]
  newAddedRoms: Rom[]
  overview: { consoles: { count: number; platform: PlatformName }[] }
  recentlySavedRoms: SavedRom[]
  rom: null | SavedRom
  state: null | State
  title: string
}

export type GamesPageData = RomList & { platformCount: number; title: string }
export type FavoritesPageData = RomList & { title: string }
export interface HistoryPageData {
  page: number
  pagination: Pagination
  roms: PlayedRom[]
  search: { query: string } | undefined
  title: string
}
export interface ConsolesPageData {
  consoles: { count: number; platform: PlatformName }[]
  title: string
}
export type PlatformPageData =
  | (RomList & { favorite: boolean; platform: PlatformName; title: string })
  | { redirect: { platform: string } }
export type RomPageData =
  | {
      discs: Disc[]
      gameSave: GameSave | undefined
      rom: Rom
      /** The game's own save is newer than its newest snapshot, as after playing it on the server */
      startFromSave?: boolean
      state: State
      states: State[]
      title: string
    }
  | { redirect: { fileName: string; platform: string } }

export interface SearchPage {
  pagination: Pagination
  platform: PlatformName | undefined
  query: string
  roms: PickedRom[]
  trimmedQuery: string
}

export interface SearchCounts {
  favorites: number
  games: number
  history: number
  platforms: Partial<Record<PlatformName, number>>
}
