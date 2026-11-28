import { Switch } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useJoinCodeSwitch } from '#@/pages/library/hooks/use-play-together.ts'
import { routes } from '#@/pages/routes.ts'
import { SettingsTitle } from '../settings-title.tsx'

/** Playing together: whether a game shared from this device asks for a code, kept in this browser */
export function PlayTogetherSettings() {
  const { t } = useTranslation()
  const [asksForCode, setAsksForCode] = useJoinCodeSwitch()

  return (
    <div>
      <SettingsTitle>{t('pauseMenu.playTogether')}</SettingsTitle>
      <div className='text-xs text-(--gray-11)'>{t('playTogether.settingsNote')}</div>
      <label className='mt-3 flex w-full items-center justify-between gap-2'>
        <SettingsTitle className='mb-0 text-base font-normal'>{t('playTogether.askForCode')}</SettingsTitle>
        <Switch checked={asksForCode} onCheckedChange={setAsksForCode} />
      </label>
      <div className='text-xs text-(--gray-11)'>{t('playTogether.askForCodeNote')}</div>
      <Link
        className='mt-3 inline-block text-sm text-(--accent-11) underline'
        data-sn-enabled=''
        to={routes.libraryJoin}
      >
        {t('nav.joinGame')}
      </Link>
    </div>
  )
}
