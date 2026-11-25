import { Switch } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import type { PlatformName } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'

export function RewindSettings({ platform }: Readonly<{ platform: PlatformName }>) {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const { rewindEnabled } = preference.emulator.platform[platform]

  async function handleRewindChange(checked: boolean) {
    await update({ emulator: { platform: { [platform]: { rewindEnabled: checked } } } })
  }

  return (
    <div>
      <SettingsTitle className='mb-0 text-base font-normal'>
        <label className='flex w-full items-center justify-between gap-2'>
          <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.rewind')}</SettingsTitle>
          <Switch checked={rewindEnabled} disabled={isLoading} onCheckedChange={handleRewindChange} />
        </label>
      </SettingsTitle>
      <div className='text-xs text-(--gray-11)'>{t('settings.rewindDescription')}</div>
    </div>
  )
}
