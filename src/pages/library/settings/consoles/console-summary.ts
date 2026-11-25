import { coreDisplayNameMap } from '#@/constants/core.ts'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { defaultPreference, type ResolvedPreference } from '#@/constants/preference.ts'

/**
 * What sets a console apart from the defaults, for its row in the list: a required BIOS file that's missing, keys or gamepad buttons of its own, a shader
 * of its own, rewinding switched the other way, and another emulator. Each is a message's key, or the emulator's name
 */
export function getConsoleSummary(preference: ResolvedPreference, platform: PlatformName) {
  const { bioses, core, rewindEnabled, shader } = preference.emulator.platform[platform]
  const defaults = defaultPreference.emulator.platform[platform]
  const biosMissing = (platformMap[platform].bioses ?? []).some(
    ({ name, required }) => required && !bioses?.some(({ fileName }) => fileName === name),
  )
  const differences: { key?: string; text?: string }[] = []
  if (Object.keys(preference.input.consoleKeys?.[platform] ?? {}).length > 0) {
    differences.push({ key: 'settings.ownKeys' })
  }
  const ownButtons = Object.values(preference.input.consoleButtons?.[platform] ?? {})
  if (ownButtons.some((buttons) => Object.keys(buttons ?? {}).length > 0)) {
    differences.push({ key: 'settings.ownButtons' })
  }
  if (shader !== undefined && shader !== 'inherit') {
    differences.push({ key: 'settings.ownShader' })
  }
  if (rewindEnabled !== defaults.rewindEnabled) {
    differences.push({ key: rewindEnabled ? 'settings.rewindOn' : 'settings.rewindOff' })
  }
  if (core !== defaults.core) {
    differences.push({ text: coreDisplayNameMap[core] })
  }
  return { biosMissing, differences }
}
