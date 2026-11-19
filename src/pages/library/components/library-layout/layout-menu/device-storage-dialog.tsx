import { Button, Dialog } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { client } from '#@/api/client.ts'
import { platformMap } from '#@/constants/platform.ts'
import {
  describeStoredGame,
  listStoredGames,
  parseStoredName,
  removeAllStoredGames,
  removeStoredGame,
  type StoredGame,
  storageLimit,
} from '#@/emulator/game-storage.ts'
import { formatBytes } from '#@/utils/client/format-bytes.ts'
import { getPlatformIcon, getRomGoodcodes } from '#@/utils/client/library.ts'
import { DialogRoot } from '../../dialog-root.tsx'

type Listed = StoredGame & { name: string }

const { $get: getRomsByFiles } = client.roms.by_files

/** Games stored before their names were kept with them are named from the library, once */
async function nameOlderGames(games: Listed[]) {
  const unnamed = games.filter((game) => !game.fileName)
  const fileIds = unnamed.map((game) => parseStoredName(game.name)?.fileId).filter(Boolean) as string[]
  if (fileIds.length === 0) {
    return games
  }
  try {
    const response = await getRomsByFiles({ query: { ids: fileIds.join(',') } })
    const roms = response.ok ? await response.json() : []
    for (const game of unnamed) {
      const rom = roms.find(({ fileId }) => fileId === parseStoredName(game.name)?.fileId)
      if (rom) {
        describeStoredGame(game.name, { fileName: rom.fileName, platform: rom.platform })
        Object.assign(game, { fileName: rom.fileName, platform: rom.platform })
      }
    }
  } catch {}
  return games
}

async function loadStorage() {
  const games = await nameOlderGames(await listStoredGames().catch(() => []))
  let available: number | undefined
  try {
    const { quota, usage } = await navigator.storage.estimate()
    available = quota === undefined ? undefined : Math.max(0, quota - (usage ?? 0))
  } catch {}
  return { available, games }
}

function daysAgo(time: number) {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  return Math.max(0, Math.ceil((startOfToday - time) / 86_400_000))
}

/** The games kept in this browser's storage, how much room they take, and a way to remove them */
export function DeviceStorageDialog({ onOpenChange, ...props }: Readonly<Dialog.RootProps>) {
  const { i18n, t } = useTranslation()
  // Read each time it opens
  const { data, mutate } = useSWR(props.open ? 'device-storage' : null, loadStorage, { revalidateOnFocus: false })
  const games = data?.games
  const available = data?.available

  async function handleRemove(name: string) {
    await removeStoredGame(name)
    await mutate()
  }

  async function handleClearAll() {
    await removeAllStoredGames()
    await mutate()
  }

  function bytes(value: number) {
    return formatBytes(value, i18n.language)
  }
  const relative = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  function played(time: number) {
    const text = relative.format(-daysAgo(time), 'day')
    return text.charAt(0).toLocaleUpperCase(i18n.language) + text.slice(1)
  }
  function title(game: Listed) {
    return game.fileName
      ? getRomGoodcodes({ fileName: game.fileName, platform: game.platform }).rom
      : t('storage.unknownGame')
  }
  function consoleName(platform?: string) {
    const info = platform ? platformMap[platform as keyof typeof platformMap] : undefined
    return info ? t(info.displayNameI18nKey) : ''
  }

  const used = games?.reduce((sum, { size }) => sum + size, 0) ?? 0

  return (
    <DialogRoot {...props} onOpenChange={onOpenChange}>
      <Dialog.Content aria-describedby={undefined} className='device-storage-dialog' maxWidth='560px'>
        <Dialog.Title className='flex items-center gap-2'>
          <span className='icon-[mdi--harddisk]' />
          {t('storage.title')}
        </Dialog.Title>

        <div className='device-storage-scroll'>
          {games?.length === 0 ? (
            <div className='py-6 text-center text-sm text-(--gray-11)'>{t('storage.empty')}</div>
          ) : null}
          {games?.length ? (
            <>
              <div className='flex flex-wrap items-baseline justify-between gap-x-4 text-sm'>
                <span className='font-semibold'>
                  {t('storage.used', { limit: bytes(storageLimit), used: bytes(used) })}
                </span>
                {available === undefined ? null : (
                  <span className='text-xs text-(--gray-11) max-sm:order-last max-sm:w-full'>
                    {t('storage.available', { size: bytes(available) })}
                  </span>
                )}
                <div className='mt-1.5 mb-1 h-2 w-full overflow-hidden rounded-full bg-(--gray-4)'>
                  <div
                    className='h-full rounded-full bg-(--accent-9)'
                    style={{ width: `${Math.min(100, (used / storageLimit) * 100)}%` }}
                  />
                </div>
              </div>
              <div className='mt-1 mb-3 text-xs text-(--gray-11)'>{t('storage.note')}</div>

              <ul>
                {games.map((game) => (
                  <li className='flex items-center gap-3 border-t border-(--gray-4) py-2.5' key={game.name}>
                    {game.platform ? (
                      <img alt='' className='size-7 shrink-0 object-contain' src={getPlatformIcon(game.platform)} />
                    ) : (
                      <span className='size-7 shrink-0' />
                    )}
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-sm font-semibold'>{title(game)}</div>
                      <div className='text-xs text-(--gray-11)'>
                        {consoleName(game.platform)}
                        <span className='sm:hidden'>
                          {game.platform ? ', ' : ''}
                          {bytes(game.size)}
                        </span>
                      </div>
                    </div>
                    <span className='text-xs whitespace-nowrap text-(--gray-11) max-sm:hidden'>
                      {played(game.lastPlayed)}
                    </span>
                    <span className='w-16 text-right text-xs whitespace-nowrap text-(--gray-11) max-sm:hidden'>
                      {bytes(game.size)}
                    </span>
                    <Button
                      aria-label={t('storage.remove')}
                      color='gray'
                      onClick={() => handleRemove(game.name)}
                      size='1'
                      title={t('storage.remove')}
                      type='button'
                      variant='surface'
                    >
                      <span className='max-sm:hidden'>{t('storage.remove')}</span>
                      <span className='icon-[mdi--close] sm:hidden' />
                    </Button>
                  </li>
                ))}
              </ul>

              <div className='mt-3 flex justify-end'>
                <Button onClick={handleClearAll} type='button' variant='soft'>
                  {t('storage.clearAll')}
                </Button>
              </div>
            </>
          ) : null}
        </div>

        <div className='settings-close absolute top-6 right-6'>
          <Dialog.Close>
            <Button aria-label={t('common.close')} type='button' variant='ghost'>
              <span className='icon-[mdi--close] size-5' />
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </DialogRoot>
  )
}
