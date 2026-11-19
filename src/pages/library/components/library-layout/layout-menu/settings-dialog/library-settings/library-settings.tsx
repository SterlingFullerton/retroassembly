import { GameEntrySettings } from './game-entry-settings.tsx'
import { PlatformSettings } from './platform-settings.tsx'

export function LibrarySettings() {
  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-5 *:first:pt-0 *:last:pb-0'>
      <PlatformSettings />
      <GameEntrySettings />
    </div>
  )
}
