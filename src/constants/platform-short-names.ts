/**
 * Short names for the consoles whose full name runs long: in the red bar on a small phone, and on every game entry, where
 * the full name shows on hover
 */
const shortNames: Record<string, string> = {
  fds: 'FDS',
  gba: 'GBA',
  gbc: 'GBC',
  ngpc: 'NGPC',
  odyssey2: 'Odyssey 2',
  psp: 'PSP',
  snes: 'SNES',
  videopac: 'Videopac+',
  wonderswancolor: 'WSC',
}

export function getPlatformShortName(name: string) {
  return shortNames[name] as string | undefined
}
