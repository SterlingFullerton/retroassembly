import { AccessibilitySettings } from './accessibility-settings.tsx'
import { GameEntrySettings } from './game-entry-settings.tsx'
import { LanguageSettings } from './language-settings.tsx'

/** How the library looks: its covers and titles, its language and its colours */
export function AppearanceSettings() {
  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-5 *:first:pt-0 *:last:pb-0'>
      <GameEntrySettings />
      <LanguageSettings />
      <AccessibilitySettings />
    </div>
  )
}
