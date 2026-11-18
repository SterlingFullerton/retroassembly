import { isCDNCacheEnabled } from '#@/utils/isomorphic/cdn.ts'
import { getRomCoverCandidates } from '#@/utils/isomorphic/rom-cover-candidates.ts'
import type { getMatchedCoverUrl } from './libretro-covers.ts'

function isBoxArt(url: string) {
  return url.includes('/Named_Boxarts/')
}

type RomForCover = Parameters<typeof getRomCoverCandidates>[0] & Parameters<typeof getMatchedCoverUrl>[0]

/**
 * Notes on each game which of its possible images the server has, so pages don't ask for images that don't exist. A
 * page would otherwise try up to six for each game without art, one after another. Only the server's CDN cache knows
 * which exist, so without it the games are left as they are and pages try them all.
 *
 * Box art comes first: under the game's own names, then, when those find none, libretro's box art matched by title
 * (see getMatchedCoverUrl), and only then a title screen or screenshot
 */
export async function addCoverCandidates<T extends RomForCover>(roms: T[]) {
  if (!isCDNCacheEnabled()) {
    return roms
  }
  const { getCachedFileStatus, isCDNCacheOffline, resolveCDNCacheTarget } = await import('./cdn-cache.ts')
  const { getMatchedCoverUrl } = await import('./libretro-covers.ts')
  const offline = isCDNCacheOffline()

  // Whether the server has an image (200), knows it doesn't exist (404), or has yet to look for it (undefined)
  async function statusOf(url: string) {
    const target = url.startsWith('/cdn/') ? resolveCDNCacheTarget(url.slice('/cdn/'.length)) : undefined
    return target ? await getCachedFileStatus(target.url, { offline }) : undefined
  }

  await Promise.all(
    roms.map(async (rom) => {
      const all = [...new Set(getRomCoverCandidates(rom).filter(Boolean))]
      const candidates: string[] = []

      // The first image the server has is the one shown, so the rest don't matter. One the server hasn't looked for
      // yet may still exist, unless the server is offline and can't fetch it
      async function found(url: string) {
        const status = await statusOf(url)
        if (status === 200 || (status === undefined && !offline)) {
          candidates.push(url)
        }
        return status === 200
      }

      async function choose() {
        for (const url of all.filter((url) => isBoxArt(url))) {
          if (await found(url)) {
            return
          }
        }
        const matched = await getMatchedCoverUrl(rom, { offline })
        if (matched && !all.includes(matched) && (await found(matched))) {
          return
        }
        for (const url of all.filter((url) => !isBoxArt(url))) {
          if (await found(url)) {
            return
          }
        }
      }

      await choose()
      Object.assign(rom, { coverCandidates: candidates })
    }),
  )
  return roms
}
