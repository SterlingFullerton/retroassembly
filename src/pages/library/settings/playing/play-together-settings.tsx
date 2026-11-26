import { Switch } from '@radix-ui/themes'
import { Link } from 'react-router'
import { usePlayTogetherSwitch } from '#@/pages/library/hooks/use-play-together.ts'
import { routes } from '#@/pages/routes.ts'
import { SettingsTitle } from '../settings-title.tsx'

/**
 * The switch for playing together, an experiment: it's kept in this browser, so it's on for this device alone. Its
 * words are in English until it's decided whether to keep it
 */
export function PlayTogetherSettings() {
  const [enabled, setEnabled] = usePlayTogetherSwitch()

  return (
    <div>
      <label className='flex w-full items-center justify-between gap-2'>
        <SettingsTitle className='mb-0'>Play together (experiment)</SettingsTitle>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </label>
      <div className='text-xs text-(--gray-11)'>
        Share a running game with one other player from its pause menu. This device only.
      </div>
      {enabled ? (
        <Link
          className='mt-2 inline-block text-sm text-(--accent-11) underline'
          data-sn-enabled=''
          to={routes.libraryJoin}
        >
          Join a game
        </Link>
      ) : null}
    </div>
  )
}
