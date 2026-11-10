import { parse } from 'goodcodes-parser'
import { Nostalgist } from 'nostalgist'
import { getCDNUrl } from '../isomorphic/cdn.ts'

export { getLibretroThumbnail, getRomLibretroThumbnail } from '../isomorphic/libretro-thumbnail.ts'

const { path } = Nostalgist.vendors

export function getDemoRomThumbnail(rom) {
  const platform = { genesis: 'md' }[rom.platform] || rom.platform
  const repo = `retrobrews/${platform}-games`
  // @ts-expect-error we know this is a valid call
  return getCDNUrl(repo, `${path.parse(rom.fileName).name}.png`)
}

// Platforms added in this fork, whose artwork ships with the app in public/assets/platforms
const bundledPlatformAssets = new Set(['nds'])

function getPlatformAsset(platform: string, file: string) {
  if (bundledPlatformAssets.has(platform)) {
    return `/assets/platforms/${file}`
  }
  return getCDNUrl('arianrhodsandlot/retroassembly-assets', `platforms/${file}`)
}

export function getPlatformIcon(platform: string) {
  return getPlatformAsset(platform, `icons/${platform}.png`)
}

export function getPlatformGameIcon(platform: string) {
  return getPlatformAsset(platform, `contents/${platform}.svg`)
}

export function getPlatformBanner(platform: string) {
  return getPlatformAsset(platform, `logos/${platform}.svg`)
}

export function getPlatformDevicePhoto(platform: string) {
  return getPlatformAsset(platform, `photos/${platform}.png`)
}

export function getPlatformDeviceBackground(platform: string) {
  return getPlatformAsset(platform, `backgrounds/${platform}.png`)
}

export function getPlatformBluredBackground(platform: string) {
  return getPlatformAsset(platform, `blured-backgrounds/${platform}.jpg`)
}

export function getRomGoodcodes(rom: { fileName?: string; rawGameMetadata?: any; name?: string; platform?: string }) {
  let { name } = path.parse(rom?.fileName || '')

  if ('name' in rom) {
    name = rom.name ?? ''
  }

  if (rom.platform === 'arcade' && rom.rawGameMetadata?.libretro?.name) {
    name = rom.rawGameMetadata.libretro.name
  }
  return parse(`0 - ${name}`)
}

export function getCompactName(name: string) {
  return name.replaceAll(/[^\p{Letter}\p{Mark}\p{Number}]/gu, '').toLowerCase()
}
