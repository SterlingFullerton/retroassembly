import { Select, Switch } from '@radix-ui/themes'
import { range } from 'es-toolkit'
import { useTranslation } from 'react-i18next'
import type { ResolvedPreference } from '#@/constants/preference.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getGlobalCSSVars } from '#@/utils/isomorphic/misc.ts'
import { SettingsTitle } from '../settings-title.tsx'

const saturationOptions = range(100, -1, -10)
function updateGlobalSaturation(resolvedPreference: ResolvedPreference) {
  for (const [key, value] of Object.entries(getGlobalCSSVars(resolvedPreference))) {
    document.body.style.setProperty(key, value)
  }
}

export function AccessibilitySettings() {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()

  return (
    <div>
      <SettingsTitle>{t('settings.accessibility')}</SettingsTitle>
      <div>
        <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
          <div>
            <label className='flex items-center justify-between gap-2'>
              <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.saturation')}</SettingsTitle>
              <Select.Root
                onValueChange={async (value) => {
                  const saturation = Math.trunc(Number(value))
                  const resolvedPreference = await update({ ui: { saturation } })
                  if (resolvedPreference) {
                    updateGlobalSaturation(resolvedPreference)
                  }
                }}
                size='2'
                value={String(preference.ui.saturation)}
              >
                <Select.Trigger disabled={isLoading} />
                <Select.Content>
                  {saturationOptions.map((option) => (
                    <Select.Item key={option} value={String(option)}>
                      {option}%
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
            <div className='text-xs text-(--gray-11)'>{t('settings.saturationDescription')}</div>
          </div>

          <label className='flex items-center justify-between gap-2'>
            <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.applyToImages')}</SettingsTitle>
            <Switch
              checked={preference.ui.saturationApplyToImages}
              disabled={isLoading}
              onCheckedChange={async (checked) => {
                const resolvedPreference = await update({ ui: { saturationApplyToImages: checked } })
                if (resolvedPreference) {
                  updateGlobalSaturation(resolvedPreference)
                }
              }}
            />
          </label>

          <label className='flex items-center justify-between gap-2'>
            <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.applyToGame')}</SettingsTitle>
            <Switch
              checked={preference.ui.saturationApplyToGame}
              disabled={isLoading}
              onCheckedChange={async (checked) => {
                const resolvedPreference = await update({ ui: { saturationApplyToGame: checked } })
                if (resolvedPreference) {
                  updateGlobalSaturation(resolvedPreference)
                }
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
