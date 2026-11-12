import { uniq } from 'es-toolkit'
import useSWRImmutable from 'swr/immutable'
import type { Rom } from '#@/controllers/roms/get-roms.ts'
import { imageLoaded } from '#@/utils/client/image.ts'
import { getDemoRomThumbnail, getPlatformGameIcon } from '#@/utils/client/library.ts'
import { getRomCoverCandidates } from '#@/utils/isomorphic/rom-cover-candidates.ts'
import { getFileUrl } from '../utils/file.ts'
import { useIsDemo } from './use-demo.ts'

export function useRomCover(rom: Rom) {
  const isDemo = useIsDemo()
  // The server notes which images it has for each game; without that note, every possible one is tried
  const { coverCandidates } = rom as { coverCandidates?: string[] }
  const romCovers = isDemo ? [getDemoRomThumbnail(rom)] : [...(coverCandidates ?? getRomCoverCandidates(rom))]
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
