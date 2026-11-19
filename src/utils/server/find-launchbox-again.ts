import path from 'node:path'
import { msleuth } from './msleuth.ts'

/**
 * A name without its revision and dump tags: "Castlevania Rev PRG1 (USA)" and "Castlevania (U) (PRG1) [!]" both become
 * names LaunchBox knows. Region and other tags in brackets are left, as the lookup reads them itself
 */
export function getNameForLaunchbox(name: string) {
  return name
    .replaceAll(/\[[^\]]*\]/gu, '')
    .replaceAll(/\s+Rev\s+[^\s(,]+/giu, '')
    .replaceAll(/\s+\((?:Rev|PRG)[^)]*\)/giu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

/**
 * LaunchBox's data (with the description) for a game libretro knows but LaunchBox didn't match: libretro's name, then
 * the file's, each without the tags that stop the match
 */
export async function findLaunchboxAgain({
  fileName,
  libretroName,
  platform,
}: Readonly<{ fileName: string; libretroName?: string; platform: string }>) {
  const { ext, name } = path.parse(fileName)
  const names = [libretroName, name]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => `${getNameForLaunchbox(candidate)}${ext}`)
  for (const candidate of new Set(names)) {
    if (candidate === ext) {
      continue
    }
    try {
      const [result] = (await msleuth.identify({ files: [{ name: candidate }], platform })) || []
      if (result?.launchbox) {
        return result.launchbox
      }
    } catch (error) {
      console.warn(error)
    }
  }
}
