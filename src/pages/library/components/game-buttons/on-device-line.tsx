import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  describeStoredGame,
  getStoredGamesSnapshot,
  getStoredName,
  type StoredGame,
  subscribeStoredGames,
} from '#@/emulator/game-storage.ts'
import { formatBytes } from '#@/utils/client/format-bytes.ts'

function getServerSnapshot() {
  return '{}'
}

/** Under Continue and Start on a game's page: whether the game is kept on this device, and its size */
export function OnDeviceLine({ rom }: Readonly<{ rom: { fileId: string; fileName: string; platform: string } }>) {
  const { i18n, t } = useTranslation()
  const snapshot = useSyncExternalStore(subscribeStoredGames, getStoredGamesSnapshot, getServerSnapshot)
  const name = getStoredName(rom.fileId)
  let entry: StoredGame | undefined
  try {
    entry = (JSON.parse(snapshot) as Record<string, StoredGame>)[name]
  } catch {}
  if (!entry) {
    return null
  }
  // A game stored before its name was kept with it gets it here
  if (!entry.fileName) {
    queueMicrotask(() => describeStoredGame(name, { fileName: rom.fileName, platform: rom.platform }))
  }
  return (
    <div className='mt-3 flex items-center gap-1.5 text-xs'>
      <span className='size-2 rounded-full bg-green-600' />
      {t('storage.onDevice')}
      <span className='text-(--gray-11)'>{formatBytes(entry.size, i18n.language)}</span>
    </div>
  )
}
