import { Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { type ThemeChoice, useThemeChoice } from '#@/pages/library/hooks/use-theme-choice.ts'
import { SettingsTitle } from '../settings-title.tsx'

/** The theme, the same choice as the menu's. It's kept in this browser, so it's for this device alone */
export function ThemeSettings() {
  const { t } = useTranslation()
  const { chooseTheme, theme } = useThemeChoice()

  return (
    <label className='flex items-center justify-between gap-2'>
      <SettingsTitle className='mb-0'>{t('settings.theme')}</SettingsTitle>
      <Select.Root onValueChange={(value) => chooseTheme(value as ThemeChoice)} size='2' value={theme}>
        <Select.Trigger />
        <Select.Content>
          <Select.Item value='system'>{t('common.system')}</Select.Item>
          <Select.Item value='light'>{t('theme.light')}</Select.Item>
          <Select.Item value='dark'>{t('theme.dark')}</Select.Item>
        </Select.Content>
      </Select.Root>
    </label>
  )
}
