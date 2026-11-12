import { isCDNCacheEnabled } from '#@/utils/isomorphic/cdn.ts'
import { getRomCoverCandidates } from '#@/utils/isomorphic/rom-cover-candidates.ts'

type RomForCover = Parameters<typeof getRomCoverCandidates>[0]

/**
 * Notes on each game which of its possible images the server has, so pages don't ask for images that don't exist. A
 * page would otherwise try up to six for each game without art, one after another. Only the server's CDN cache knows
 * which exist, so without it the games are left as they are and pages try them all.
 */
export async function addCoverCandidates<T extends RomForCover>(roms: T[]) {
  if (!isCDNCacheEnabled()) {
    return roms
  }
  const { getCachedFileStatus, isCDNCacheOffline, resolveCDNCacheTarget } = await import('./cdn-cache.ts')
  const offline = isCDNCacheOffline()
  await Promise.all(
    roms.map(async (rom) => {
      const candidates: string[] = []
      for (const url of new Set(getRomCoverCandidates(rom).filter(Boolean))) {
        const target = url.startsWith('/cdn/') ? resolveCDNCacheTarget(url.slice('/cdn/'.length)) : undefined
        const status = target ? await getCachedFileStatus(target.url, { offline }) : undefined
        if (status === 200) {
          // The first image the server has is the one shown, so the rest don't matter
          candidates.push(url)
          break
        }
        // One the server hasn't looked for yet may still exist, unless the server is offline and can't fetch it
        if (status === undefined && !offline) {
          candidates.push(url)
        }
      }
      Object.assign(rom, { coverCandidates: candidates })
    }),
  )
  return roms
}
