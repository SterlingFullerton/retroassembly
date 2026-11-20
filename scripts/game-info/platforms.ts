import type { PlatformName } from '#@/constants/platform.ts'

/**
 * Each console's names in libretro's database (its .rdb files) and in LaunchBox's (its <Platform>). Kept here, apart
 * from the console definitions, so the database can be built without loading the app; a unit test checks the libretro
 * names against the consoles'. Arcade games are matched against all three of libretro's arcade lists
 */
export const gameInfoPlatforms = {
  arcade: { launchbox: 'Arcade', libretro: ['MAME', 'MAME 2003-Plus', 'FBNeo - Arcade Games'] },
  atari2600: { launchbox: 'Atari 2600', libretro: ['Atari - 2600'] },
  atari5200: { launchbox: 'Atari 5200', libretro: ['Atari - 5200'] },
  atari7800: { launchbox: 'Atari 7800', libretro: ['Atari - 7800'] },
  atarilynx: { launchbox: 'Atari Lynx', libretro: ['Atari - Lynx'] },
  channelf: { launchbox: 'Fairchild Channel F', libretro: ['Fairchild - Channel F'] },
  colecovision: { launchbox: 'ColecoVision', libretro: ['Coleco - ColecoVision'] },
  famicom: { launchbox: 'Nintendo Entertainment System', libretro: ['Nintendo - Nintendo Entertainment System'] },
  fds: { launchbox: 'Nintendo Famicom Disk System', libretro: ['Nintendo - Family Computer Disk System'] },
  gameandwatch: { launchbox: 'Nintendo Game & Watch', libretro: ['Handheld Electronic Game'] },
  gamegear: { launchbox: 'Sega Game Gear', libretro: ['Sega - Game Gear'] },
  gb: { launchbox: 'Nintendo Game Boy', libretro: ['Nintendo - Game Boy'] },
  gba: { launchbox: 'Nintendo Game Boy Advance', libretro: ['Nintendo - Game Boy Advance'] },
  gbc: { launchbox: 'Nintendo Game Boy Color', libretro: ['Nintendo - Game Boy Color'] },
  genesis: { launchbox: 'Sega Genesis', libretro: ['Sega - Mega Drive - Genesis'] },
  megadrive: { launchbox: 'Sega Genesis', libretro: ['Sega - Mega Drive - Genesis'] },
  n64: { launchbox: 'Nintendo 64', libretro: ['Nintendo - Nintendo 64'] },
  nds: { launchbox: 'Nintendo DS', libretro: ['Nintendo - Nintendo DS'] },
  nes: { launchbox: 'Nintendo Entertainment System', libretro: ['Nintendo - Nintendo Entertainment System'] },
  ngp: { launchbox: 'SNK Neo Geo Pocket', libretro: ['SNK - Neo Geo Pocket'] },
  ngpc: { launchbox: 'SNK Neo Geo Pocket Color', libretro: ['SNK - Neo Geo Pocket Color'] },
  odyssey2: { launchbox: 'Magnavox Odyssey 2', libretro: ['Magnavox - Odyssey2'] },
  pcengine: { launchbox: 'NEC TurboGrafx-16', libretro: ['NEC - PC Engine - TurboGrafx 16'] },
  psp: { launchbox: 'Sony PSP', libretro: ['Sony - PlayStation Portable'] },
  psx: { launchbox: 'Sony Playstation', libretro: ['Sony - PlayStation'] },
  sega32x: { launchbox: 'Sega 32X', libretro: ['Sega - 32X'] },
  sfc: {
    launchbox: 'Super Nintendo Entertainment System',
    libretro: ['Nintendo - Super Nintendo Entertainment System'],
  },
  'sg-1000': { launchbox: 'Sega SG-1000', libretro: ['Sega - SG-1000'] },
  sms: { launchbox: 'Sega Master System', libretro: ['Sega - Master System - Mark III'] },
  snes: {
    launchbox: 'Super Nintendo Entertainment System',
    libretro: ['Nintendo - Super Nintendo Entertainment System'],
  },
  vb: { launchbox: 'Nintendo Virtual Boy', libretro: ['Nintendo - Virtual Boy'] },
  videopac: { launchbox: 'Philips Videopac+', libretro: ['Philips - Videopac+'] },
  wonderswan: { launchbox: 'WonderSwan', libretro: ['Bandai - WonderSwan'] },
  wonderswancolor: { launchbox: 'WonderSwan Color', libretro: ['Bandai - WonderSwan Color'] },
} as const satisfies Record<PlatformName, { launchbox: string; libretro: readonly string[] }>

export const launchboxPlatformNames = new Set<string>(
  Object.values(gameInfoPlatforms).map(({ launchbox }) => launchbox),
)
export const libretroPlatformNames = new Set<string>(
  Object.values(gameInfoPlatforms).flatMap(({ libretro }) => libretro),
)
