import { mapValues } from 'es-toolkit'
import { mergePreference } from '../utils/isomorphic/preference.ts'
import type { CoreName } from './core'
import { platformMap, type PlatformName } from './platform.ts'

export type PlatformSortBy = 'alphabet' | 'popularity' | 'release_date'
export type PlatformSortOrder = 'ascending' | 'descending'

export interface Preference {
  emulator: {
    autoSaveInterval: number
    core: Partial<Record<CoreName, Record<string, string>>>
    /** Whether a game goes fullscreen when it starts; 'auto' is on phones and tablets (see goesFullscreen) */
    fullscreen: 'auto' | boolean
    platform: Record<
      PlatformName,
      {
        /** shared: the library owner's, for a player who shares their library; only the owner can remove it */
        bioses: { fileId: string; fileName: string; shared?: boolean }[]
        core: CoreName
        rewindEnabled: boolean
        shader?: string
      }
    >
    shader: string
    videoSmooth: boolean
  }
  input: {
    confirmButtonStyle: string
    /** The player's own keys for a console, over the shared keyboard mapping: RetroArch's setting and its key */
    /** The player's own gamepad buttons for a console, by gamepad, over that gamepad's mapping */
    consoleButtons?: Partial<Record<PlatformName, Record<string, Record<string, string>>>>
    consoleKeys?: Partial<Record<PlatformName, Record<string, string>>>
    gamepadMappings: Record<
      string,
      {
        $fast_forward: string
        $pause: string
        $rewind: string
        input_player1_a_btn: string
        input_player1_b_btn: string
        input_player1_down_btn: string
        input_player1_l1_btn: string
        input_player1_l2_btn: string
        input_player1_l3_btn: string
        input_player1_left_btn: string
        input_player1_r1_btn: string
        input_player1_r2_btn: string
        input_player1_r3_btn: string
        input_player1_right_btn: string
        input_player1_select_btn: string
        input_player1_start_btn: string
        input_player1_up_btn: string
        input_player1_x_btn: string
        input_player1_y_btn: string
      }
    >
    keyboardMapping: {
      // The library's own keys, once set (see src/input/navigation-keys.ts)
      $cancel?: string
      $confirm?: string
      $down?: string
      $left?: string
      $right?: string
      $up?: string
      $pause: string
      input_hold_fast_forward: string
      input_player1_a: string
      input_player1_b: string
      input_player1_down: string
      input_player1_l1: string
      input_player1_l2: string
      input_player1_l3: string
      input_player1_left: string
      input_player1_r1: string
      input_player1_r2: string
      input_player1_r3: string
      input_player1_right: string
      input_player1_select: string
      input_player1_start: string
      input_player1_up: string
      input_player1_x: string
      input_player1_y: string
      input_player1_l_x_minus: string
      input_player1_l_x_plus: string
      input_player1_l_y_minus: string
      input_player1_l_y_plus: string
      input_player1_r_x_minus: string
      input_player1_r_x_plus: string
      input_player1_r_y_minus: string
      input_player1_r_y_plus: string
      input_rewind: string
    }
  }
  ui: {
    dateFormat: string
    language: string
    libraryCoverSize: string
    libraryCoverType: 'boxart'
    platforms: PlatformName[]
    saturation: number
    saturationApplyToGame: boolean
    saturationApplyToImages: boolean
    showDistrictOnTitle: boolean
    showFocusIndicators: string
    showSidebar: boolean
    showTitle: boolean
  }
}

export interface ResolvedPreference extends Preference {
  emulator: NonNullable<Preference['emulator']>
  input: {
    confirmButtonStyle: NonNullable<Preference['input']>['confirmButtonStyle']
    /** Only there once a console has been given keys of its own */
    consoleButtons?: NonNullable<Preference['input']>['consoleButtons']
    consoleKeys?: NonNullable<Preference['input']>['consoleKeys']
    gamepadMappings: NonNullable<NonNullable<Preference['input']>['gamepadMappings']>
    keyboardMapping: NonNullable<NonNullable<Preference['input']>['keyboardMapping']>
  }
  ui: NonNullable<Preference['ui']>
}

type PartialDeepNullable<T> = {
  [K in keyof T]?: T[K] extends readonly (infer U)[]
    ? null | readonly PartialDeepNullable<U>[]
    : T[K] extends (infer U)[]
      ? null | PartialDeepNullable<U>[]
      : T[K] extends Record<string, unknown>
        ? null | PartialDeepNullable<T[K]>
        : null | T[K]
}

export type PreferenceSnippet = PartialDeepNullable<Preference>

export const defaultPreference: ResolvedPreference = {
  emulator: {
    autoSaveInterval: 0,
    core: {
      desmume: {
        desmume_pointer_type: 'touch',
      },
      desmume2015: {
        // Follow the mouse or finger position, instead of moving the stylus by the mouse's movement
        desmume_pointer_type: 'touch',
      },
      fceumm: {
        fceumm_turbo_enable: 'Both',
      },
      mame2003_plus: {
        'mame2003-plus_skip_disclaimer': 'enabled',
      },
      melonds: {
        // Follow the mouse or finger position, instead of moving the stylus by the mouse's movement
        melonds_touch_mode: 'Touch',
      },
      mgba: {
        mgba_gb_colors: 'DMG Green',
        mgba_skip_bios: 'ON',
      },
      ppsspp: {
        // When the emulator falls behind, as phones do in some busy scenes, a frame goes undrawn instead of the sound
        // breaking up. Frames are only skipped while it's behind, so where it keeps up nothing changes
        ppsspp_auto_frameskip: 'enabled',
        ppsspp_frameskip: '1',
      },
    },
    fullscreen: 'auto',
    platform: mapValues(platformMap, ({ cores: [core] }, name) => ({
      bioses: [],
      core,
      // Rewinding saves the console's whole state every few frames: for the PlayStation, N64, DS and PSP, whose states
      // are large, that nearly doubles the work of each frame (Crash Bandicoot: 3.2 ms a frame without, 5.7 with)
      rewindEnabled: !['n64', 'nds', 'psp', 'psx'].includes(name),
      shader: 'inherit',
    })),
    shader: '',
    videoSmooth: false,
  },
  input: {
    // Automatic: Xbox style with a Valve controller, such as a Steam Deck's, whose A button is the bottom one; Nintendo
    // style otherwise
    confirmButtonStyle: 'auto',
    gamepadMappings: {},
    keyboardMapping: {
      $pause: 'escape',
      input_hold_fast_forward: 'space',
      input_player1_a: 'x',
      input_player1_b: 'z',
      input_player1_down: 'down',
      input_player1_l_x_minus: '',
      input_player1_l_x_plus: '',
      input_player1_l_y_minus: '',
      input_player1_l_y_plus: '',
      input_player1_l1: 'q',
      input_player1_l2: '',
      input_player1_l3: '',
      input_player1_left: 'left',
      input_player1_r_x_minus: '',
      input_player1_r_x_plus: '',
      input_player1_r_y_minus: '',
      input_player1_r_y_plus: '',
      input_player1_r1: 'w',
      input_player1_r2: '',
      input_player1_r3: '',
      input_player1_right: 'right',
      input_player1_select: 'rshift',
      input_player1_start: 'enter',
      input_player1_up: 'up',
      input_player1_x: 's',
      input_player1_y: 'a',
      input_rewind: 'r',
    },
  },
  ui: {
    dateFormat: 'auto',
    language: 'auto',
    libraryCoverSize: 'medium',
    libraryCoverType: 'boxart',
    platforms: ['arcade', 'atari2600', 'gb', 'gba', 'gbc', 'genesis', 'nes', 'snes'],
    saturation: 100,
    saturationApplyToGame: false,
    saturationApplyToImages: false,
    showDistrictOnTitle: false,
    showFocusIndicators: 'auto',
    showSidebar: true,
    showTitle: true,
  },
}

export function resolveUserPreference(rawUserPreference: null | PreferenceSnippet) {
  const userPreference = structuredClone(rawUserPreference) || {}
  for (const key of ['emulator', 'ui', 'input'] as const) {
    userPreference[key] ||= {}
  }
  const fallbackPreference = structuredClone(defaultPreference)

  const userKeyboardMapping = userPreference.input?.keyboardMapping

  if (userKeyboardMapping && fallbackPreference.input && 'keyboardMapping' in fallbackPreference.input) {
    // @ts-expect-error force delete this field
    fallbackPreference.input.keyboardMapping = undefined
  }

  // a temporary fix. there should be a better way to handle this
  if (userPreference.ui && !userPreference.ui?.platforms) {
    delete userPreference.ui.platforms
  }

  return mergePreference(fallbackPreference, userPreference) as Preference
}

/**
 * Whether a game goes fullscreen when it starts. Left on Automatic, it does on a device you mainly touch, where the
 * phone's own bars otherwise take a quarter of the height from the game, and not on a computer
 */
export function goesFullscreen(fullscreen: Preference['emulator']['fullscreen']) {
  if (typeof fullscreen === 'boolean') {
    return fullscreen
  }
  return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
}
