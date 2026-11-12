export type VirtualGamepadLabelButton = 'a' | 'b' | 'l' | 'l2' | 'r' | 'r2' | 'select' | 'start' | 'x' | 'y'

// A label to show on the button, or null to hide a button the emulator does nothing with
export type VirtualGamepadLabels = Record<VirtualGamepadLabelButton, null | string>

const genericLabels: VirtualGamepadLabels = {
  a: 'A',
  b: 'B',
  l: 'L1',
  l2: 'L2',
  r: 'R1',
  r2: 'R2',
  select: 'Select',
  start: 'Start',
  x: 'X',
  y: 'Y',
}

const noShoulders = { l: null, l2: null, r: null, r2: null }

// What each emulator does with the generic buttons, from its libretro documentation. Only emulators whose mapping is
// documented are listed; the rest keep the generic labels.
const labelsByPlatformAndCore: Record<string, Partial<VirtualGamepadLabels>> = {
  'colecovision/gearcoleco': {
    a: 'Fire R',
    b: 'Fire L',
    l: '3',
    l2: '5',
    r: '4',
    r2: '6',
    select: '#',
    start: '✱',
    x: '2',
    y: '1',
  },
  'fds/fceumm': { ...noShoulders, l: 'Disk side', r: 'Eject', x: null, y: null },
  'gamegear/genesis_plus_gx': { ...noShoulders, a: '2', b: '1', select: null, x: null, y: null },
  'gb/mgba': { ...noShoulders, x: null, y: null },
  'gba/mgba': { l: 'L', l2: null, r: 'R', r2: null, x: null, y: null },
  'gbc/mgba': { ...noShoulders, x: null, y: null },
  'genesis/genesis_plus_gx': { a: 'C', b: 'B', l: 'X', l2: null, r: 'Z', r2: null, select: 'Mode', x: 'Y', y: 'A' },
  'megadrive/genesis_plus_gx': { a: 'C', b: 'B', l: 'X', l2: null, r: 'Z', r2: null, select: 'Mode', x: 'Y', y: 'A' },
  // The C buttons are the right stick; the RetroPad's X and A do nothing unless R2 is held
  'n64/mupen64plus_next': { a: null, b: 'A', l: 'L', l2: 'Z', r: 'R', r2: null, select: null, x: null, y: 'B' },
  'nes/fceumm': { ...noShoulders, x: null, y: null },
  'pcengine/mednafen_pce_fast': {
    a: 'I',
    b: 'II',
    l: null,
    l2: 'Mode',
    r: null,
    r2: null,
    start: 'Run',
    x: 'Turbo I',
    y: 'Turbo II',
  },
  'psx/pcsx_rearmed': { a: '○', b: '✕', x: '△', y: '□' },
  'sfc/snes9x': { l: 'L', l2: null, r: 'R', r2: null },
  'sms/genesis_plus_gx': { ...noShoulders, a: '2', b: '1', select: null, start: 'Pause', x: null, y: null },
  'snes/snes9x': { l: 'L', l2: null, r: 'R', r2: null },
  'wonderswan/mednafen_wswan': { l: 'Y◀', l2: 'Y▼', r: 'Y▶', r2: 'Y▲', select: 'Rotate', x: null, y: null },
  'wonderswancolor/mednafen_wswan': { l: 'Y◀', l2: 'Y▼', r: 'Y▶', r2: 'Y▲', select: 'Rotate', x: null, y: null },
}

export function getVirtualGamepadLabels(platform?: string, core?: string): VirtualGamepadLabels {
  return { ...genericLabels, ...labelsByPlatformAndCore[`${platform}/${core}`] }
}
