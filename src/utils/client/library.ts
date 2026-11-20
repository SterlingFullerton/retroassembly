import { parse } from 'goodcodes-parser'
import { Nostalgist } from 'nostalgist'

export { getLibretroThumbnail, getRomLibretroThumbnail } from '../isomorphic/libretro-thumbnail.ts'

const { path } = Nostalgist.vendors

// Every console's artwork ships with the app, in public/assets/platforms (see its readme for where it comes from)
function getPlatformAsset(file: string) {
  return `/assets/platforms/${file}`
}

export function getPlatformIcon(platform: string) {
  return getPlatformAsset(`icons/${platform}.png`)
}

export function getPlatformGameIcon(platform: string) {
  return getPlatformAsset(`contents/${platform}.svg`)
}

export function getPlatformBanner(platform: string) {
  return getPlatformAsset(`logos/${platform}.svg`)
}

export function getPlatformDevicePhoto(platform: string) {
  return getPlatformAsset(`photos/${platform}.webp`)
}

export function getPlatformBluredBackground(platform: string) {
  return getPlatformAsset(`blured-backgrounds/${platform}.jpg`)
}

export function getRomGoodcodes(rom: {
  fileName?: string
  gameTitle?: null | string
  name?: string
  platform?: string
  rawGameMetadata?: any
}) {
  let { name } = path.parse(rom?.fileName || '')

  if ('name' in rom) {
    name = rom.name ?? ''
  }

  if (rom.platform === 'arcade' && rom.rawGameMetadata?.libretro?.name) {
    name = rom.rawGameMetadata.libretro.name
  }
  const goodcodes = parse(`0 - ${name}`)
  goodcodes.rom = moveArticleToFront(goodcodes.rom)
  // A name the player gave the game is shown as they wrote it
  if (rom.gameTitle?.trim()) {
    goodcodes.rom = rom.gameTitle.trim()
  }
  return goodcodes
}

/** File names put an article last, as in "Legend of Zelda, The - Link's Awakening", which reads better with it first */
export function moveArticleToFront(name: string) {
  return name.replace(/^(?<title>.+?), (?<article>The|A|An)(?=$| - )/u, '$<article> $<title>')
}

export function getCompactName(name: string) {
  return name.replaceAll(/[^\p{Letter}\p{Mark}\p{Number}]/gu, '').toLowerCase()
}
