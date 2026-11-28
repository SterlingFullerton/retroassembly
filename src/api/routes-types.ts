// The server's API routes, with what each takes and sends. The server is the Go server (server/internal/web); this file
// is kept in step with it by hand, and the end-to-end tests use every route the pages use
import type { PlatformName } from '#@/constants/platform.ts'
import type { PreferenceSnippet } from '#@/constants/preference.ts'
import type { Endpoint, NoInput, UrlOf } from './request.ts'
import type {
  Account,
  CommonPageData,
  ConsolesPageData,
  Favorite,
  FavoritesPageData,
  GamesPageData,
  GameSave,
  HistoryPageData,
  HomePageData,
  LibraryLayoutData,
  LoginPageData,
  PickedRom,
  PlatformPageData,
  PlayedRom,
  Pagination,
  Preference,
  RomPageData,
  RomRow,
  SearchCounts,
  SearchPage,
  Session,
  SignedInDevice,
  State,
  User,
} from './types.ts'

interface Id {
  param: { id: string }
}
/** A save state of a game on the NAS: kept there, for whoever started the game */
interface NASState {
  created: string
  id: string
  size: number
}

/** A list's sort, order, page and search, as the page has them in its address */
interface ListQuery {
  query?: { direction?: string; favorite?: string; page?: string; q?: string; sort?: string }
}

export interface ApiRoutes {
  auth: {
    login: { $post: Endpoint<{ form: { password: string; username: string } }, { session: Session; user: User }> }
    password: { $patch: Endpoint<{ form: { new_password: string; password: string } }, true> }
    register: { $post: Endpoint<{ form: { password: string; username: string } }, { session: Session; user: User }> }
  }
  favorites: {
    ':romId': { $delete: Endpoint<{ param: { romId: string } }, null> }
    $post: Endpoint<{ json: { romId: string } }, Favorite>
    $url: UrlOf<{ param: { romId: string } }>
  }
  game_saves: {
    ':id': { restore: { $post: Endpoint<Id, GameSave> } }
    $get: Endpoint<{ query: { core: string; rom: string } }, GameSave[]>
    $post: Endpoint<
      { form: { clientId?: string; core: string; file: Blob; fileType?: string; rom: string; savedAgo?: string } },
      GameSave
    >
  }
  launch_records: {
    $get: Endpoint<{ query?: { page?: string; page_size?: string } }, { pagination: Pagination; roms: PlayedRom[] }>
    $post: Endpoint<{ form: { core: string; rom: string } }, null>
  }
  pages: {
    common: { $get: Endpoint<{ query?: { path?: string } }, CommonPageData> }
    library: {
      $get: Endpoint<NoInput, LibraryLayoutData>
      consoles: { $get: Endpoint<NoInput, ConsolesPageData> }
      favorites: { $get: Endpoint<ListQuery, FavoritesPageData> }
      history: { $get: Endpoint<ListQuery, HistoryPageData> }
      home: { $get: Endpoint<NoInput, HomePageData> }
      platform: {
        $get: Endpoint<{ query: NonNullable<ListQuery['query']> & { platform: string } }, PlatformPageData>
      }
      rom: { $get: Endpoint<{ query: { file_name: string; platform: string } }, RomPageData> }
      roms: { $get: Endpoint<ListQuery, GamesPageData> }
    }
    login: { $get: Endpoint<{ query?: { error?: string; redirect_to?: string } }, LoginPageData> }
  }
  nas_games: {
    ':code': {
      $delete: Endpoint<{ param: { code: string } }, null>
      states: {
        ':state': { load: { $post: Endpoint<{ param: { code: string; state: string } }, true> } }
        $get: Endpoint<{ param: { code: string } }, NASState[]>
        $post: Endpoint<{ param: { code: string } }, NASState>
      }
    }
    cores: { $get: Endpoint<NoInput, string[]> }
    $post: Endpoint<
      { json: { controls: string; core: string; linked?: boolean; rom: string; saveFileType?: string } },
      { code: string; friendCode?: string }
    >
  }
  play_together: {
    invitations: {
      ':code': {
        $delete: Endpoint<{ param: { code: string } }, null>
        $get: Endpoint<
          { param: { code: string } },
          { controls: string; core?: string; host: string; offer: string; platform?: string; title: string }
        >
        answer: {
          $get: Endpoint<{ param: { code: string } }, { answer: string } | null>
          $post: Endpoint<{ json: { answer: string }; param: { code: string } }, true>
        }
      }
      $get: Endpoint<NoInput, { code: string; controls: string; host: string; title: string }[]>
      $post: Endpoint<
        { json: { controls: string; core?: string; listed: boolean; offer: string; platform?: string; title: string } },
        { code: string }
      >
    }
    address: { $get: Endpoint<NoInput, { address: string }> }
  }
  preference: {
    $get: Endpoint<NoInput, Preference>
    $post: Endpoint<{ json: PreferenceSnippet }, Preference>
    bioses: {
      $delete: Endpoint<{ query: { file_name: string; platform: PlatformName } }, Preference>
      $post: Endpoint<{ form: { file: File; platform: PlatformName } }, Preference>
    }
  }
  roms: {
    ':id': {
      $delete: Endpoint<Id, null>
      $patch: Endpoint<
        Id & {
          form: {
            gameBoxartFileIds?: string
            gameDescription?: string
            gameDeveloper?: string
            gameGenres?: string
            gameName?: string
            gamePlayers?: string
            gamePublisher?: string
            gameReleaseDate?: string
            gameThumbnailFileIds?: string
            gameTitle?: string
          }
        },
        RomRow
      >
      boxart: {
        $delete: Endpoint<Id, null>
        $post: Endpoint<Id & { form: { file: File } }, null | string>
      }
      launch_records: { $delete: Endpoint<Id, null> }
      states: { $get: Endpoint<Id & { query?: { type?: 'auto' | 'manual' } }, State[]> }
      thumbnail: {
        ':thumbnailId{.+}': { $delete: Endpoint<{ param: { id: string; thumbnailId: string } }, null | string> }
        $post: Endpoint<Id & { form: { file: File } }, null | string>
      }
    }
    $delete: Endpoint<{ query: { ids: string } }, null>
    $post: Endpoint<{ form: { file: File; md5?: string; platform: PlatformName } }, RomRow>
    by_files: {
      $get: Endpoint<
        { query: { ids: string } },
        { fileId: string; fileName: string; gameTitle: null | string; platform: PlatformName }[]
      >
    }
    on_this_day: { $get: Endpoint<{ query: { date: string } }, PickedRom[]> }
    play_together: { $get: Endpoint<NoInput, PickedRom[]> }
    rediscover: { $get: Endpoint<NoInput, PickedRom[]> }
    search: {
      $get: Endpoint<{ query: { page?: string; page_size?: string; platform?: string; query: string } }, SearchPage>
    }
    search_counts: { $get: Endpoint<{ query: { query: string } }, SearchCounts> }
  }
  states: {
    ':id': { $delete: Endpoint<Id, null> }
    $get: Endpoint<{ query: { rom: string; type: 'auto' | 'manual' } }, State[]>
    $post: Endpoint<
      {
        form: {
          clientId?: string
          core: string
          disc?: string
          rom: string
          savedAgo?: string
          state: Blob
          thumbnail: Blob
          type: 'auto' | 'manual'
        }
      },
      State
    >
  }
  users: {
    ':id': {
      $delete: Endpoint<Id, { success: true }>
      $patch: Endpoint<Id & { form: { role?: string; username?: string } }, User>
      password: { $put: Endpoint<Id & { form: { new_password: string } }, { success: true }> }
    }
    $get: Endpoint<NoInput, Account[]>
    $post: Endpoint<{ form: { password?: string; role?: string; username: string } }, User>
    current: { delete: { $post: Endpoint<{ form: { password?: string } }, { success: true }> } }
  }
  sessions: {
    $get: Endpoint<NoInput, SignedInDevice[]>
    others: { $delete: Endpoint<NoInput, { ended: number }> }
  }
}
