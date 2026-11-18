import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import type { loader } from '#@/pages/routes/library-platform.tsx'
import { DeviceInfo } from '../components/device-info/device-info.tsx'
import { GameListMain } from '../components/game-list-main.tsx'
import { GameListActions } from '../components/game-list/game-list-actions.tsx'
import { PlatformBackground } from './components/platform-background.tsx'
import { UploadButton } from './components/upload-button.tsx'

export default function PlatformPage() {
  const { t } = useTranslation()
  const { pagination, platform, roms, search } = useLoaderData<typeof loader>()

  if (!platformMap[platform]) {
    return <>{t('error.notFoundCode')}</>
  }

  if (pagination.current > 1 && roms.length === 0) {
    return <>{t('error.notFoundCode')}</>
  }

  // How many games (on a computer: a phone's line has no room) and Add, at the start of the Favorites and Sort line.
  // While searching, how many match is in the sidebar and the console tabs instead. A console with no games has its
  // Add in the empty message, so it isn't shown twice
  const empty = !search && pagination.total === 0
  const leading = empty ? null : (
    <>
      {search ? null : (
        <span className='mr-1 hidden text-sm whitespace-nowrap text-(--gray-11) lg:inline'>
          {pagination.total} {t('common.game', { count: pagination.total })}
        </span>
      )}
      <UploadButton platform={platform} />
    </>
  )

  return (
    <>
      <PlatformBackground />

      <div className='relative'>
        <GameListMain actionsInHeader actionsLeading={leading}>
          <DeviceInfo actions={<GameListActions className='px-0' leading={leading} />} platform={platform} />
        </GameListMain>
      </div>
    </>
  )
}
