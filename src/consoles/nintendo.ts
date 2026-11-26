import type { ConsoleDefinition } from './types.ts'

// Nintendo
export const nintendoConsoles = {
  famicom: {
    bioses: [
      {
        name: 'nes.pal',
      },
      {
        name: 'gamegenie.nes',
      },
    ],
    cores: ['fceumm', 'nestopia', 'quicknes'],
    displayNameI18nKey: 'platform.famicom',
    fileExtensions: ['.nes', '.unif', '.unf', '.zip'],
    info: {
      developer: 'Nintendo R&D2',
      manufacturer: 'Nintendo Co., Ltd.',
      notesI18nKey: 'platform.nesNote',
      releaseDate: '1983-07-15T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Nintendo Entertainment System',
    // Every NES emulator reads the controller's buttons as they are
    setups: [
      {
        controls: 'nes',
      },
    ],
  },
  fds: {
    attachVirtualGamepad: true,
    bioses: [
      {
        md5: 'ca30b50f880eb660a320674ed365ef7a',
        name: 'disksys.rom',
        required: true,
      },
      {
        name: 'nes.pal',
      },
      {
        md5: '7f98d77d7a094ad7d069b74bd553ec98',
        name: 'gamegenie.nes',
      },
    ],
    cores: ['fceumm', 'nestopia'],
    displayNameI18nKey: 'platform.famicomDiskSystem',
    fileExtensions: ['.fds', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Mitsumi',
      notesI18nKey: 'platform.famicomDiskSystemNote',
      releaseDate: '1986-02-21T00:00:00-08:00',
    },
    libretroName: 'Nintendo - Family Computer Disk System',
    // Played with the NES's controls, plus a button that flips the disk
    setups: [
      {
        controls: 'fds',
        cores: ['fceumm', 'nestopia'],
      },
    ],
  },
  gameandwatch: {
    cores: ['gw'],
    displayNameI18nKey: 'platform.gameAndWatch',
    fileExtensions: ['.zip', '.mgw'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.gameAndWatchNote',
      releaseDate: '1980-04-28T00:00:00-07:00',
    },
    libretroName: 'Handheld Electronic Game',
    // gw reads the Game & Watch's d-pad, A and B, and its menu from Select and Start
    setups: [
      {
        controls: 'gw',
        cores: ['gw'],
      },
    ],
  },
  gb: {
    bioses: [
      {
        md5: '32fbbd84168d3482956eb3c5051637f5',
        name: 'gb_bios.bin',
      },
    ],
    cores: ['mgba', 'gearboy', 'gambatte', 'tgbdual'],
    displayNameI18nKey: 'platform.gameBoy',
    fileExtensions: ['.gb', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.gameBoyNote',
      releaseDate: '1989-04-21T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Game Boy',
    // Every Game Boy emulator reads the Game Boy's buttons as they are; Game Boy Color games look the same
    setups: [
      {
        controls: 'gb',
      },
    ],
  },
  gba: {
    bioses: [
      {
        md5: 'a860e8c0b6d573d191e4ec7db1b1e4f6',
        name: 'gba_bios.bin',
      },
    ],
    cores: ['mgba', 'vba_next'],
    displayNameI18nKey: 'platform.gameBoyAdvance',
    fileExtensions: ['.gba', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.gameBoyAdvanceNote',
      releaseDate: '2001-06-11T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Game Boy Advance',
    // mGBA and VBA Next both read the GBA's buttons as they are
    setups: [
      {
        controls: 'gba',
      },
    ],
  },
  gbc: {
    bioses: [
      {
        md5: 'dbfce9db9deaa2567f6a84fde55f9680',
        name: 'gbc_bios.bin',
      },
    ],
    cores: ['mgba', 'gearboy', 'gambatte', 'tgbdual'],
    displayNameI18nKey: 'platform.gameBoyColor',
    fileExtensions: ['.gb', '.gbc', '.cgb', '.sgb', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.gameBoyColorNote',
      releaseDate: '1998-10-21T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Game Boy Color',
    // Every Game Boy emulator reads the Game Boy's buttons as they are; Game Boy Color games look the same
    setups: [
      {
        controls: 'gb',
      },
    ],
  },
  n64: {
    cores: ['mupen64plus_next'],
    displayNameI18nKey: 'platform.n64',
    fileExtensions: ['.n64', '.z64', '.zip'],
    info: {
      developer: 'Nintendo R&D2',
      manufacturer: 'Nintendo Co., Ltd.',
      notesI18nKey: 'platform.n64Note',
      releaseDate: '1996-06-23T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Nintendo 64',
    setups: [
      {
        controller: [
          { color: '#6f9bff', label: 'A', retropad: 'b' },
          { color: '#4fcf68', label: 'B', retropad: 'y' },
          { label: 'Z', retropad: 'l2' },
          { label: 'L', retropad: 'l' },
          { label: 'R', retropad: 'r' },
          { color: '#ff6b5e', label: 'Start', retropad: 'start' },
        ],
        controls: 'n64',
        hints: 'n64',
        keyboard: 'n64',
      },
    ],
  },
  nds: {
    cores: ['desmume2015', 'desmume', 'melonds'],
    displayNameI18nKey: 'platform.nds',
    fileExtensions: ['.nds', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo Co., Ltd.',
      notesI18nKey: 'platform.ndsNote',
      releaseDate: '2004-11-21T00:00:00-08:00',
    },
    libretroName: 'Nintendo - Nintendo DS',
    // The bottom screen is a touchscreen; the microphone is held on L3
    setups: [
      {
        controls: 'ds',
        keyboard: 'ds',
      },
    ],
  },
  nes: {
    cores: ['fceumm', 'nestopia', 'quicknes'],
    displayNameI18nKey: 'platform.nes',
    fileExtensions: ['.nes', '.unif', '.unf', '.zip'],
    info: {
      developer: 'Nintendo R&D2',
      manufacturer: 'Nintendo Co., Ltd.',
      notesI18nKey: 'platform.nesNote',
      releaseDate: '1983-07-15T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Nintendo Entertainment System',
    // Every NES emulator reads the controller's buttons as they are
    setups: [
      {
        controls: 'nes',
      },
    ],
  },
  sfc: {
    cores: ['snes9x', 'snes9x2002', 'snes9x2005', 'snes9x2010'],
    displayNameI18nKey: 'platform.sfc',
    fileExtensions: ['.smc', '.sfc', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.snesNote',
      releaseDate: '1990-11-21T00:00:00+09:00',
    },
    libretroName: 'Nintendo - Super Nintendo Entertainment System',
    // Every Snes9x reads the controller's buttons as they are
    setups: [
      {
        controls: 'snes',
        cores: ['snes9x', 'snes9x2002', 'snes9x2005', 'snes9x2010'],
      },
    ],
  },
  snes: {
    cores: ['snes9x', 'snes9x2002', 'snes9x2005', 'snes9x2010'],
    displayNameI18nKey: 'platform.snes',
    fileExtensions: ['.smc', '.sfc', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.snesNote',
      releaseDate: '1990-11-21T00:00:00-08:00',
    },
    libretroName: 'Nintendo - Super Nintendo Entertainment System',
    // Every Snes9x reads the controller's buttons as they are
    setups: [
      {
        controls: 'snes',
        cores: ['snes9x', 'snes9x2002', 'snes9x2005', 'snes9x2010'],
      },
    ],
  },
  vb: {
    cores: ['mednafen_vb'],
    displayNameI18nKey: 'platform.virtualBoy',
    fileExtensions: ['.vb', '.vboy', '.zip'],
    info: {
      developer: 'Nintendo',
      manufacturer: 'Nintendo',
      notesI18nKey: 'platform.virtualBoyNote',
      releaseDate: '1995-07-21T00:00:00-07:00',
    },
    libretroName: 'Nintendo - Virtual Boy',
    setups: [
      {
        controls: 'vb',
        cores: ['mednafen_vb'],
      },
    ],
  },
} as const satisfies Record<string, ConsoleDefinition>
