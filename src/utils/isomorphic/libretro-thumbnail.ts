import { capitalize, trim } from 'es-toolkit'
import { platformMap } from '#@/constants/platform.ts'
import { getCDNUrl, libretroThumbnailsHost, toCDNCacheUrl } from './cdn.ts'

export type LibretroThumbnailType = 'boxart' | 'logo' | 'snap' | 'title'

/** A game's file name without its extension, keeping any full stops in the name: "Dr. Mario (World).gb" is "Dr. Mario (World)" */
export function getNameWithoutExtension(fileName = '') {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** The folder libretro keeps a console's art in, such as "Nintendo - Game Boy"; all arcade games are in "MAME" */
export function getLibretroConsoleFolder(platform: string) {
  const name = platformMap[platform]?.libretroName || platform
  return name?.includes('MAME') ? 'MAME' : name
}

export function getLibretroThumbnail({
  host = 'jsdelivr',
  platform,
  name,
  type = 'boxart',
}: {
  host?: 'jsdelivr' | 'libretro'
  name: string
  platform: string
  type?: LibretroThumbnailType
}) {
  if (!name || !platform) {
    return ''
  }
  const platformFullName = getLibretroConsoleFolder(platform)
  if (!platformFullName) {
    return ''
  }

  const normalizedPlatformFullName = platformFullName.replaceAll(' ', '_')
  const repo = `libretro-thumbnails/${trim(normalizedPlatformFullName, '+')}`

  const fileDirectory = `Named_${capitalize(type)}s`
  const normalizedFileName = `${name.replaceAll(/[&*/:`<>?\\]|\|"/gu, '_')}.png`
  const filePath = `${fileDirectory}/${normalizedFileName}`

  if (host === 'jsdelivr') {
    // @ts-expect-error we know this is a valid call
    return getCDNUrl(repo, filePath)
  }

  const result = new URL([platformFullName, fileDirectory, normalizedFileName].join('/'), libretroThumbnailsHost).href

  return toCDNCacheUrl(result)
}

export function getRomLibretroThumbnail(
  rom: {
    platform?: string
    rawGameMetadata?: {
      libretro?: { name?: null | string; platform?: null | string } | null
    } | null
  },
  type: LibretroThumbnailType = 'boxart',
  host: 'jsdelivr' | 'libretro' = 'libretro',
) {
  const libretroGame = rom.rawGameMetadata?.libretro
  const name = libretroGame?.name
  if (!name || !rom.platform) {
    return ''
  }
  const platform = libretroGame?.platform || platformMap[rom.platform].libretroName || rom.platform
  return getLibretroThumbnail({ host, name, platform, type })
}
