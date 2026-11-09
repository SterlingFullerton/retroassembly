import { uniq } from 'es-toolkit'
import useSWRImmutable from 'swr/immutable'
import type { Rom } from '#@/controllers/roms/get-roms.ts'
import { imageLoaded } from '#@/utils/client/image.ts'
import {
  getDemoRomThumbnail,
  getLibretroThumbnail,
  getPlatformGameIcon,
  getRomLibretroThumbnail,
} from '#@/utils/client/library.ts'
import { isCDNCacheEnabled } from '#@/utils/isomorphic/cdn.ts'
import { getFileUrl } from '../utils/file.ts'
import { useIsDemo } from './use-demo.ts'

const libretroThumbnailTypes = ['boxart', 'title', 'snap'] as const
export function useRomCover(rom: Rom) {
  const isDemo = useIsDemo()
  const romCovers = isDemo
    ? [getDemoRomThumbnail(rom)]
    : [
        ...libretroThumbnailTypes.map((type) => getRomLibretroThumbnail(rom, type, 'libretro')),
        // jsDelivr mirrors the same images, so it's skipped when the server caches them
        ...(isCDNCacheEnabled()
          ? []
          : libretroThumbnailTypes.map((type) => getRomLibretroThumbnail(rom, type, 'jsdelivr'))),
        ...libretroThumbnailTypes.map((type) =>
          getLibretroThumbnail({ host: 'libretro', name: rom.fileName.split('.')[0], platform: rom.platform, type }),
        ),
        ...(isCDNCacheEnabled()
          ? []
          : libretroThumbnailTypes.map((type) =>
              getLibretroThumbnail({
                host: 'jsdelivr',
                name: rom.fileName.split('.')[0],
                platform: rom.platform,
                type,
              }),
            )),
      ]
  if (rom.gameBoxartFileIds) {
    romCovers.unshift(...rom.gameBoxartFileIds.split(',').map((fileId) => getFileUrl(fileId)))
  }
  const uniqueRomCovers = uniq(romCovers).filter(Boolean)
  const platformCover = getPlatformGameIcon(rom.platform)
  const covers = [...uniqueRomCovers, platformCover]

  return useSWRImmutable(covers, async () => {
    for (const romCover of uniqueRomCovers) {
      try {
        await imageLoaded(romCover)
        return { src: romCover, type: 'rom' }
      } catch {}
    }
    return { src: platformCover, type: 'platform' }
  })
}
