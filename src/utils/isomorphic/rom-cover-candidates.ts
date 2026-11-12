import { isCDNCacheEnabled } from './cdn.ts'
import { getLibretroThumbnail, getRomLibretroThumbnail } from './libretro-thumbnail.ts'

const libretroThumbnailTypes = ['boxart', 'title', 'snap'] as const

interface RomForCover {
  fileName: null | string
  platform: string
  rawGameMetadata?: { libretro?: { name?: null | string; platform?: null | string } | null } | null
}

/** The libretro images that may show a game, best first: box art, title screen, then screenshot */
export function getRomCoverCandidates(rom: RomForCover) {
  const name = rom.fileName?.split('.')[0] ?? ''
  // jsDelivr mirrors the same images, so it's skipped when the server caches them
  const hosts = isCDNCacheEnabled() ? (['libretro'] as const) : (['libretro', 'jsdelivr'] as const)
  return [
    ...hosts.flatMap((host) => libretroThumbnailTypes.map((type) => getRomLibretroThumbnail(rom, type, host))),
    ...hosts.flatMap((host) =>
      libretroThumbnailTypes.map((type) => getLibretroThumbnail({ host, name, platform: rom.platform, type })),
    ),
  ]
}
