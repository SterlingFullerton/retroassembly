/**
 * Short names for the consoles whose full name runs long: in the red bar on a small phone, and on every game entry, where
 * the full name shows on hover
 */
const shortNames: Record<string, string> = {
  colecovision: 'Coleco',
  famicom: 'Famicom',
  fds: 'FDS',
  gameandwatch: 'G&W',
  gba: 'GBA',
  gbc: 'GBC',
  n64: 'N64',
  nds: 'NDS',
  ngp: 'NGP',
  ngpc: 'NGPC',
  odyssey2: 'Odyssey 2',
  psp: 'PSP',
  psx: 'PS',
  sfc: 'SFC',
  'sg-1000': 'SG-1000',
  sms: 'SMS',
  snes: 'SNES',
  vb: 'VB',
  videopac: 'Videopac+',
  wonderswancolor: 'WSC',
}

export function getPlatformShortName(name: string) {
  return shortNames[name] as string | undefined
}
