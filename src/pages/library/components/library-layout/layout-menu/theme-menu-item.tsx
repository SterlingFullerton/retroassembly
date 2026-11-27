import { DropdownMenu } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { delay } from 'es-toolkit'
import { useTranslation } from 'react-i18next'
import { type ThemeChoice, useThemeChoice } from '#@/pages/library/hooks/use-theme-choice.ts'

export function ThemeMenuItem() {
  const { chooseTheme, systemTheme, theme } = useThemeChoice()
  const { t } = useTranslation()

  async function updateTheme(choice: ThemeChoice) {
    await delay(100)
    chooseTheme(choice)
  }

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <span className='icon-[mdi--theme-light-dark]' />
        {t('settings.theme')}
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        <DropdownMenu.Item onClick={() => updateTheme('system')}>
          <span className={clsx('icon-[mdi--check]', { 'opacity-0': theme !== 'system' })} />
          {systemTheme === 'light' ? <span className='icon-[mdi--weather-sunny]' /> : null}
          {systemTheme === 'dark' ? <span className='icon-[mdi--moon-and-stars]' /> : null}
          {t('common.system')}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onClick={() => updateTheme('light')}>
          <span className={clsx('icon-[mdi--check]', { 'opacity-0': theme !== 'light' })} />
          <span className='icon-[mdi--weather-sunny]' />
          {t('theme.light')}
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => updateTheme('dark')}>
          <span className={clsx('icon-[mdi--check]', { 'opacity-0': theme !== 'dark' })} />
          <span className='icon-[mdi--moon-and-stars]' />
          {t('theme.dark')}
        </DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  )
}
