import { useTranslation } from 'react-i18next'
import { getPlatformShortName } from '#@/constants/platform-short-names.ts'
import { platformMap } from '#@/constants/platform.ts'
import { getPlatformIcon } from '#@/utils/client/library.ts'
import { usePlatform } from '../../hooks/use-platform.ts'

/**
 * The console on a game entry's console line, by its short name where it has one; not on that console's own page. With
 * `iconOnly`, where a row's own label takes the room, only its icon, with the name on hover
 */
export function GamePlatform({ iconOnly = false, platform }: Readonly<{ iconOnly?: boolean; platform: string }>) {
  const { t } = useTranslation()
  const currentPlatform = usePlatform()

  if (currentPlatform) {
    return
  }

  const name = t(platformMap[platform].displayNameI18nKey)
  return (
    <span className='flex min-w-0 items-center gap-1.5' title={name}>
      <img
        alt={iconOnly ? name : ''}
        className='size-3.5 shrink-0 object-contain'
        loading='lazy'
        src={getPlatformIcon(platform)}
      />
      {iconOnly ? null : <span className='truncate'>{getPlatformShortName(platform) ?? name}</span>}
    </span>
  )
}
