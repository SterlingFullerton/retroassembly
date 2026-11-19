import type { RetroPadButton } from '../input/retropad.ts'
import type { CoreName } from './emulators.ts'

/** Which on-screen controls a game gets on a touch screen; `generic` is the RetroPad layout with the console's labels */
export type ControlsKind =
  | 'arcade'
  | 'atari2600'
  | 'atari5200'
  | 'atari7800'
  | 'channelf'
  | 'colecovision'
  | 'ds'
  | 'fds'
  | 'gamegear'
  | 'gb'
  | 'gba'
  | 'generic'
  | 'genesis'
  | 'gw'
  | 'lynx'
  | 'mastersystem'
  | 'n64'
  | 'nes'
  | 'ngp'
  | 'odyssey2'
  | 'pcengine'
  | 'psp'
  | 'psx'
  | 'snes'
  | 'vb'
  | 'wonderswan'

/** The keys a game needs beyond the shared keyboard mapping */
export type KeyboardKind = 'arcade' | 'colecovision' | 'ds' | 'genesis' | 'n64' | 'odyssey2' | 'standard'

/** How the pause menu describes the keyboard */
export type HintsKind = 'arcade' | 'colecovision' | 'generic' | 'genesis' | 'n64'

export interface Bios {
  md5?: string
  name: string
  required?: boolean
}

/** A button on the console's own controller, and the RetroPad button its emulator reads it from */
export interface ControllerButton {
  /** Its colour on the controller, for the keyboard hints */
  color?: string
  /** The key it moves to when the shared keyboard defaults would put the controller's buttons out of order */
  key?: string
  /** What it's called on the controller */
  label: string
  retropad: RetroPadButton
}

/** How a console is played with some of its emulators; `cores` left out means with any of them */
export interface Setup {
  controller?: ControllerButton[]
  controls: ControlsKind
  cores?: CoreName[]
  hints?: HintsKind
  keyboard?: KeyboardKind
}

export interface ConsoleDefinition {
  /** The on-screen gamepad's sticks or extra buttons drive the game whichever emulator plays it */
  attachVirtualGamepad?: boolean
  bioses?: Bios[]
  /** Select inserts a coin */
  coin?: boolean
  /** Games come on several discs, named "… (Disc 1)", "… (Disc 2)" and so on, which are listed and played as one */
  multiDisc?: boolean
  /** The emulators that play it, the default first */
  cores: CoreName[]
  displayNameI18nKey: string
  fileExtensions: string[]
  info: {
    developer?: string
    manufacturer?: string
    notesI18nKey: string
    releaseDate: string
  }
  libretroName: string
  setups?: Setup[]
}

/** How an emulator is started and run */
export interface LaunchProfile {
  /** The on-screen gamepad's sticks or extra buttons drive the game, so the gamepad is attached to the emulator */
  attachVirtualGamepad?: boolean
  /**
   * Runs on several threads, which browsers only allow on a page sent with cross-origin isolation headers. Its games'
   * pages are sent with them, and opened with a full page load
   */
  threads?: boolean
  /** A larger audio buffer, in milliseconds, for an emulator whose frames can take too long */
  audioLatency?: number
  /** Its own screenshots aren't usable, so a save's thumbnail is taken from the canvas instead */
  canvasThumbnail?: boolean
  /** Told by a remap file that its controller is a DualShock */
  dualShockRemap?: boolean
  /** Too slow for run-ahead, and given a larger rewind buffer */
  heavy?: boolean
  /** Paused and resumed once after starting, which it needs to run */
  nudgeAfterStart?: boolean
  /** Which of the on-screen gamepad's sticks are analog axes, on a touch screen */
  stickAxes?: 'both' | 'left'
}

export interface EmulatorDefinition {
  displayName: string
  /**
   * Where the emulator keeps the game's own saves, when they're a folder of files rather than one file, relative to
   * RetroArch's saves folder. The folder is kept as one zip
   */
  saveFolder?: string
  /** The extension of the game's own save (memory card, battery save) as the emulator writes it; srm when left out */
  saveFileType?: string
  launch?: LaunchProfile
  /** Shipped with the app, built for this fork, or from the RetroArch Emscripten build */
  source: 'bundled' | 'retroarch'
}
