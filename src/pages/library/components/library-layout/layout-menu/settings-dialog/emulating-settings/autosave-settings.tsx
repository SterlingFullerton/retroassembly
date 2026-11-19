import { Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'

const INTERVAL_OPTIONS = [
  { label: 'Disabled', value: 0 },
  { label: 10, value: 10 },
  { label: 20, value: 20 },
  { label: 30, value: 30 },
  { label: 40, value: 40 },
  { label: 50, value: 50 },
  { label: 60, value: 60 },
] as const

export function AutosaveSettings() {
  const { env } = useGlobalLoaderData()
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const interval = preference.emulator.autoSaveInterval

  async function handleIntervalChange(value: string) {
    const newInterval = value === '0' ? 0 : Math.trunc(Number(value))
    if (newInterval !== interval) {
      await update({
        emulator: {
          autoSaveInterval: newInterval,
        },
      })
    }
  }

  return (
    <div>
      <SettingsTitle>{t('emulator.saveState')}</SettingsTitle>
      <div>
        <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
          <div>
            <SettingsTitle className='mb-0 justify-between text-base font-normal'>
              {t('settings.autoSaveInterval')}
              <Select.Root onValueChange={handleIntervalChange} value={String(interval)}>
                <Select.Trigger disabled={isLoading} />
                <Select.Content>
                  {INTERVAL_OPTIONS.map(({ label: _label, value }) => (
                    <Select.Item key={value} value={String(value)}>
                      {value === 0 ? t('common.disabled') : `${value} ${t('common.seconds')}`}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </SettingsTitle>
            <div className='text-xs text-(--gray-11)'>
              {t('emulator.autoSaveSlotsDescription', {
                count: Number(env.RETROASSEMBLY_RUN_TIME_MAX_AUTO_STATES_PER_ROM),
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
