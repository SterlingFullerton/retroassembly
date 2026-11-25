import { generatePath, useLocation, useParams, useRouteLoaderData } from 'react-router'
import { routes } from '#@/pages/routes.ts'

export type SettingsSectionName = 'account' | 'appearance' | 'consoles' | 'controls' | 'playing' | 'server'

interface SettingsSection {
  /** Only admins have it */
  adminOnly?: boolean
  iconClass: string
  /** The message that names it */
  label: string
  name: SettingsSectionName
}

const sections: SettingsSection[] = [
  { iconClass: 'icon-[mdi--palette]', label: 'settings.appearance', name: 'appearance' },
  { iconClass: 'icon-[mdi--controller]', label: 'settings.controls', name: 'controls' },
  { iconClass: 'icon-[mdi--play-circle]', label: 'settings.playing', name: 'playing' },
  { iconClass: 'icon-[mdi--gamepad-classic]', label: 'nav.consoles', name: 'consoles' },
  { iconClass: 'icon-[mdi--account]', label: 'common.account', name: 'account' },
  // Everyone's accounts
  { adminOnly: true, iconClass: 'icon-[mdi--server]', label: 'settings.server', name: 'server' },
]

/** A section's address, or that of a console's own settings */
export function getSettingsPath(section?: SettingsSectionName, console?: string) {
  if (section === 'consoles' && console) {
    return generatePath(routes.librarySettingsConsole, { console })
  }
  return section ? generatePath(routes.librarySettingsSection, { section }) : routes.librarySettings
}

/**
 * The settings' sections the user has, and the one open. With none in the address the first is shown on a computer,
 * and the list of them on a phone (`current` is then undefined)
 */
export function useSettingsSections() {
  const isAdmin = Boolean(useRouteLoaderData('library')?.isAdmin)
  const { section } = useParams()
  const shown = sections.filter(({ adminOnly }) => isAdmin || !adminOnly)
  const current = shown.find(({ name }) => name === section)
  return { current, sections: shown, shown: current ?? shown[0] }
}

/** Where Settings was opened from, which its way back returns to: kept as the sections are moved between */
export function useSettingsOrigin() {
  const { pathname, search, state } = useLocation()
  const from: unknown = (state as null | { from?: unknown })?.from
  const origin = typeof from === 'string' && from.startsWith('/library') ? from : routes.libraryHome
  const inSettings = pathname.startsWith(routes.librarySettings)
  /** The state for a link into, or within, the settings */
  const linkState = { from: inSettings ? origin : `${pathname}${search}` }
  return { linkState, origin }
}
