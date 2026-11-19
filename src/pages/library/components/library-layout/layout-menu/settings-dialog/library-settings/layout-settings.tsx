import { Switch } from '@radix-ui/themes'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'

export function LayoutSettings() {
  const { isLoading, preference, update } = usePreference()

  return (
    <div>
      <SettingsTitle>Layout</SettingsTitle>
      <div>
        <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
          <label className='flex items-center justify-between gap-2'>
            <SettingsTitle className='text-base font-normal'>Show Sidebar</SettingsTitle>
            <Switch
              checked={preference.ui.showSidebar}
              disabled={isLoading}
              onCheckedChange={(checked) => update({ ui: { showSidebar: checked } })}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
