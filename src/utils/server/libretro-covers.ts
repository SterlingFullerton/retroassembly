import fs from 'node:fs'
import { attemptAsync } from 'es-toolkit'
import { libretroThumbnailsHost } from '#@/utils/isomorphic/cdn.ts'
import {
  getLibretroConsoleFolder,
  getLibretroThumbnail,
  getNameWithoutExtension,
} from '#@/utils/isomorphic/libretro-thumbnail.ts'
import { getCachedFile } from './cdn-cache.ts'

// libretro files many covers under names that differ from the game's: other region or language tags, another naming
// style ("Peek-A-Boo Poker (1991)(Panesian)(EU-US)"), other capitals or punctuation. Its list of each console's box art
// is kept with the cache, and a game whose exact names find nothing is matched against it by title

// libretro adds covers now and then, so its lists are fetched again once they're a week old
const listMaxAge = 7 * 24 * 60 * 60 * 1000

interface CoverRom {
  fileName: null | string
  platform: string
  rawGameMetadata?: {
    launchbox?: { name?: null | string } | null
    libretro?: { name?: null | string; platform?: null | string } | null
  } | null
}

/** The page listing a console's box art on libretro's thumbnail server */
export function getCoverListUrl(consoleFolder: string) {
  return new URL(`${encodeURIComponent(consoleFolder)}/Named_Boxarts/`, libretroThumbnailsHost).href
}

/**
 * What a name says about the game alone: no region, language or dump tags, "The" moved to the front, and only letters
 * and digits. "Legend of Zelda, The - Link's Awakening (USA) [!]" and "The Legend of Zelda: Link's Awakening (Europe)"
 * are both "thelegendofzeldalinksawakening"
 */
export function getTitleKey(name: string) {
  let title = name.replace(/\.png$/iu, '').replaceAll(/\s*[([][^)\]]*[)\]]/gu, '')
  const article = /^(?<rest>.*?), (?<article>The|A|An)(?<subtitle> - .*)?$/u.exec(title)?.groups
  if (article) {
    title = `${article.article} ${article.rest}${article.subtitle ?? ''}`
  }
  return title
    .toLowerCase()
    .replaceAll('&', 'and')
    .replaceAll(/[^a-z\d]/gu, '')
}

// Region tags in No-Intro ("USA, Europe"), TOSEC ("EU-US") and GoodTools ("U", "JU") names
const regionAliases: Record<string, string[]> = {
  as: ['asia'],
  asia: ['asia'],
  au: ['australia'],
  australia: ['australia'],
  b: ['brazil'],
  br: ['brazil'],
  brazil: ['brazil'],
  de: ['germany'],
  e: ['europe'],
  eu: ['europe'],
  europe: ['europe'],
  f: ['france'],
  fr: ['france'],
  france: ['france'],
  g: ['germany'],
  germany: ['germany'],
  j: ['japan'],
  japan: ['japan'],
  jp: ['japan'],
  ju: ['japan', 'usa'],
  k: ['korea'],
  korea: ['korea'],
  kr: ['korea'],
  u: ['usa'],
  ue: ['usa', 'europe'],
  us: ['usa'],
  usa: ['usa'],
  w: ['world'],
  world: ['world'],
}

export function getRegions(name: string) {
  const regions = new Set<string>()
  for (const { groups } of name.matchAll(/\((?<tag>[^)]*)\)/gu)) {
    const tag = groups?.tag ?? ''
    for (const part of tag.split(/,\s*|-/u)) {
      for (const region of regionAliases[part.trim().toLowerCase()] ?? []) {
        regions.add(region)
      }
    }
  }
  return regions
}

// Bad or altered copies, and games that aren't the release itself, are a last resort
const lesserCopy = /\[(?:b|h|p|a|f|t|o)[^\]]*\]|\((?:hack|beta|proto|demo|pirate|sample)[^)]*\)/giu
const regionPreference = ['usa', 'world', 'europe', 'japan']

/** How well one of libretro's covers suits a game: its own region first, then a clean copy, then a common region */
function scoreCover(cover: string, gameRegions: Set<string>) {
  const regions = getRegions(cover)
  let score = [...regions].some((region) => gameRegions.has(region)) ? 1000 : 0
  score -= (cover.match(lesserCopy)?.length ?? 0) * 100
  const preferred = Math.min(
    ...[...regions].map((region) => {
      const index = regionPreference.indexOf(region)
      return index === -1 ? regionPreference.length : index
    }),
    regionPreference.length + 1,
  )
  score -= preferred * 10
  return score - cover.length / 1000
}

const coverLists = new Map<string, { byTitle: Map<string, string[]>; time: number }>()

/** libretro's box art for a console, by title, from the copy kept with the cache */
async function getCoverList(consoleFolder: string, { offline = false } = {}) {
  const url = getCoverListUrl(consoleFolder)
  const [, cached] = await attemptAsync(() => getCachedFile(url, { maxAge: listMaxAge, offline }))
  if (cached?.status !== 200) {
    return
  }
  const known = coverLists.get(consoleFolder)
  if (known && known.time === cached.time) {
    return known
  }
  const html = await fs.promises.readFile(cached.path, 'utf8')
  const byTitle = new Map<string, string[]>()
  for (const { groups } of html.matchAll(/<a href="(?<href>[^"?/][^"]*\.png)"/gu)) {
    const href = groups?.href ?? ''
    const name = decodeURIComponent(href).replace(/\.png$/iu, '')
    const key = getTitleKey(name)
    byTitle.set(key, [...(byTitle.get(key) ?? []), name])
  }
  const list = { byTitle, time: cached.time }
  coverLists.set(consoleFolder, list)
  return list
}

/** Fetches libretro's list of covers for each console, so matching works offline. Run by the prefetch */
export async function refreshCoverList(consoleFolder: string) {
  return Boolean(await getCoverList(consoleFolder))
}

/**
 * The address of libretro's box art for a game whose own names find none, matched by title: its name in libretro's
 * database, its file name, then its LaunchBox name. Undefined when libretro has no box art with that title
 */
export async function getMatchedCoverUrl(rom: CoverRom, { offline = false } = {}) {
  const libretro = rom.rawGameMetadata?.libretro
  const consoleFolder = getLibretroConsoleFolder(libretro?.platform || rom.platform)
  if (!consoleFolder) {
    return
  }
  const list = await getCoverList(consoleFolder, { offline })
  if (!list) {
    return
  }
  const fileName = getNameWithoutExtension(rom.fileName ?? '')
  const names = [libretro?.name, fileName, rom.rawGameMetadata?.launchbox?.name].filter(Boolean) as string[]
  const gameRegions = new Set(names.flatMap((name) => [...getRegions(name)]))
  for (const name of names) {
    const covers = list.byTitle.get(getTitleKey(name))
    if (covers?.length) {
      const [best] = covers.toSorted((a, b) => scoreCover(b, gameRegions) - scoreCover(a, gameRegions))
      return getLibretroThumbnail({ host: 'libretro', name: best, platform: consoleFolder, type: 'boxart' })
    }
  }
}
