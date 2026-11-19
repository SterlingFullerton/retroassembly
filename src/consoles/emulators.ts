import type { EmulatorDefinition } from './types.ts'

export const emulators = {
  a5200: { displayName: 'a5200', launch: { attachVirtualGamepad: true, stickAxes: 'both' }, source: 'bundled' },
  desmume2015: {
    displayName: 'DeSmuME 2015',
    launch: { audioLatency: 160, heavy: true },
    saveFileType: 'dsv',
    source: 'bundled',
  },
  fbneo: { displayName: 'FinalBurn Neo', launch: { attachVirtualGamepad: true }, source: 'retroarch' },
  fceumm: { displayName: 'FCEUmm', source: 'retroarch' },
  freechaf: { displayName: 'FreeChaF', launch: { attachVirtualGamepad: true }, source: 'retroarch' },
  gambatte: { displayName: 'Gambatte', source: 'retroarch' },
  gearboy: { displayName: 'Gearboy', source: 'retroarch' },
  gearcoleco: {
    displayName: 'Gearcoleco',
    launch: { attachVirtualGamepad: true, stickAxes: 'left' },
    source: 'retroarch',
  },
  gearsystem: { displayName: 'Gearsystem', source: 'retroarch' },
  genesis_plus_gx: { displayName: 'Genesis Plus GX', source: 'retroarch' },
  gw: { displayName: 'GW', source: 'retroarch' },
  handy: { displayName: 'Handy', source: 'retroarch' },
  mame2003_plus: { displayName: 'MAME 2003-Plus', source: 'retroarch' },
  mednafen_lynx: { displayName: 'Beetle Lynx', source: 'retroarch' },
  mednafen_ngp: { displayName: 'Beetle NeoPop', source: 'retroarch' },
  mednafen_pce_fast: { displayName: 'Beetle PC Engine Fast', source: 'retroarch' },
  mednafen_vb: { displayName: 'Beetle VB', launch: { attachVirtualGamepad: true }, source: 'retroarch' },
  mednafen_wswan: { displayName: 'Beetle Wonderswan', source: 'retroarch' },
  mgba: { displayName: 'mGBA', source: 'retroarch' },
  mupen64plus_next: {
    displayName: 'Mupen64Plus-Next',
    launch: {
      attachVirtualGamepad: true,
      canvasThumbnail: true,
      heavy: true,
      nudgeAfterStart: true,
      stickAxes: 'both',
    },
    source: 'bundled',
  },
  nestopia: { displayName: 'Nestopia', source: 'retroarch' },
  o2em: { displayName: 'O2EM', launch: { attachVirtualGamepad: true }, source: 'retroarch' },
  pcsx_rearmed: {
    displayName: 'PCSX ReARMed',
    launch: { attachVirtualGamepad: true, dualShockRemap: true, heavy: true, stickAxes: 'both' },
    source: 'retroarch',
  },
  picodrive: { displayName: 'PicoDrive', source: 'retroarch' },
  // PSP, built for this fork from EmulatorJS's copy of PPSSPP, which keeps it building for browsers. Its games save
  // into folders on the memory stick. Its sound keeps 80 ms queued as a reserve against short stalls (patched into its
  // build), which RetroArch keeps there by aiming for half of this latency
  ppsspp: {
    displayName: 'PPSSPP',
    launch: {
      attachVirtualGamepad: true,
      audioLatency: 160,
      canvasThumbnail: true,
      heavy: true,
      stickAxes: 'left',
      threads: true,
    },
    saveFileType: 'zip',
    saveFolder: 'PPSSPP/PSP/SAVEDATA',
    source: 'bundled',
  },
  prosystem: { displayName: 'ProSystem', launch: { attachVirtualGamepad: true }, source: 'bundled' },
  quicknes: { displayName: 'QuickNES', source: 'retroarch' },
  snes9x: { displayName: 'Snes9x', source: 'retroarch' },
  snes9x2002: { displayName: 'Snes9x 2002', source: 'retroarch' },
  snes9x2005: { displayName: 'Snes9x 2005', source: 'retroarch' },
  snes9x2010: { displayName: 'Snes9x 2010', source: 'retroarch' },
  stella2014: { displayName: 'Stella 2014', launch: { attachVirtualGamepad: true }, source: 'bundled' },
  tgbdual: { displayName: 'TGB Dual', source: 'retroarch' },
  vba_next: { displayName: 'VBA Next', source: 'retroarch' },
} as const satisfies Record<string, EmulatorDefinition>

export type CoreName = keyof typeof emulators
