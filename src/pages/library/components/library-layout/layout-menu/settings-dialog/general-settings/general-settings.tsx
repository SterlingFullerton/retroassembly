import { AccessibilitySettings } from './accessibility-settings.tsx'
import { AccountsSettings } from './accounts-settings.tsx'
import { LanguageSettings } from './language-settings.tsx'

export function GeneralSettings() {
  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-5 *:first:pt-0 *:last:pb-0'>
      <LanguageSettings />
      <AccessibilitySettings />
      <AccountsSettings />
    </div>
  )
}
