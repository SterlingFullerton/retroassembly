import { Switch } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useJoinCodeSwitch, usePlayTogetherSwitch } from '#@/pages/library/hooks/use-play-together.ts'
import { routes } from '#@/pages/routes.ts'
import { SettingsTitle } from '../settings-title.tsx'

/**
 * The switch for playing together, an experiment: it's kept in this browser, so it's on for this device alone. Its
 * words are in English until it's decided whether to keep it
 */
export function PlayTogetherSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePlayTogetherSwitch()
  const [asksForCode, setAsksForCode] = useJoinCodeSwitch()

  return (
    <div>
      <label className='flex w-full items-center justify-between gap-2'>
        <SettingsTitle className='mb-0'>Play together (experiment)</SettingsTitle>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </label>
      <div className='text-xs text-(--gray-11)'>
        Share a running game from this device with one other player, from its pause menu. This device only.
      </div>
      {enabled ? (
        <>
          <label className='mt-3 flex w-full items-center justify-between gap-2'>
            <SettingsTitle className='mb-0 text-base font-normal'>Ask for a code to join</SettingsTitle>
            <Switch checked={asksForCode} onCheckedChange={setAsksForCode} />
          </label>
          <div className='text-xs text-(--gray-11)'>
            Off, anyone signed in can join a game you share. On, they need the code your pause menu shows.
          </div>
        </>
      ) : null}
      {/* Joining needs no switch: only sharing a game from this device does */}
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
