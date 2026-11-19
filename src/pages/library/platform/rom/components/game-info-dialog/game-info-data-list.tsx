import { Select, TextArea, TextField } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { range } from 'es-toolkit'
import { useTranslation } from 'react-i18next'
import { useDate } from '#@/pages/library/hooks/use-date.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'

export function GameInfoDataList({ autoFocusField }: Readonly<{ autoFocusField?: string }>) {
  const { t } = useTranslation()
  const rom = useRom()
  const { formatDate, isValidDate } = useDate()

  const dataListFields = [
    {
      label: t('common.released'),
      name: 'gameReleaseDate',
      placeholder: `e.g. ${formatDate('1990-03-15')}`,
      type: 'input' as const,
    },
    {
      label: t('common.players'),
      name: 'gamePlayers',
      options: [...range(1, 11).map((v) => `${v}`), 'unknown'],
      type: 'select' as const,
    },
    {
      label: t('common.developer'),
      name: 'gameDeveloper',
      type: 'input' as const,
    },
    {
      label: t('common.publisher'),
      name: 'gamePublisher',
      type: 'input' as const,
    },
    {
      label: t('common.genres'),
      name: 'gameGenres',
      type: 'input' as const,
    },
    {
      label: t('common.description'),
      name: 'gameDescription',
      type: 'textarea' as const,
    },
  ]

  const launchboxGame = rom.rawGameMetadata?.launchbox
  const gameInfo = {
    gameDescription: rom.gameDescription ?? launchboxGame?.overview,
    gameDeveloper: rom.gameDeveloper ?? launchboxGame?.developer,
    gameGenres: rom.gameGenres ?? launchboxGame?.genres,
    gamePlayers: rom.gamePlayers ?? launchboxGame?.maxPlayers ?? '',
    gamePublisher: rom.gamePublisher ?? launchboxGame?.publisher,
    gameReleaseDate: rom.gameReleaseDate ?? launchboxGame?.releaseDate,
  }
  if (gameInfo.gameReleaseDate) {
    gameInfo.gameReleaseDate = isValidDate(gameInfo.gameReleaseDate) ? formatDate(gameInfo.gameReleaseDate) : ''
  }
  if (gameInfo.gamePlayers) {
    gameInfo.gamePlayers = Math.trunc(Number(`${gameInfo.gamePlayers}`)) ? `${gameInfo.gamePlayers}` : 'unknown'
  }

  // Released and Players, Developer and Publisher side by side where there's room; Genres and Description across
  const wide = new Set(['gameDescription', 'gameGenres'])

  return (
    <div className='grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2'>
      {dataListFields.map(({ label, name, options, type, ...valueProps }) => (
        <label className={clsx('flex flex-col gap-1', { 'sm:col-span-2': wide.has(name) })} key={name}>
          <span className='text-xs text-(--gray-11)'>{label}</span>
          {
            {
              input: (
                <TextField.Root
                  autoFocus={autoFocusField === name}
                  defaultValue={gameInfo[name]}
                  name={name}
                  {...valueProps}
                />
              ),
              select: (
                <Select.Root defaultValue={`${gameInfo[name]}`} name={name}>
                  <Select.Trigger aria-label={label} autoFocus={autoFocusField === name} />
                  <Select.Content>
                    {options?.map((opt) => (
                      <Select.Item key={opt} value={opt}>
                        {opt === 'unknown' ? t('common.unknown') : opt}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              ),
              textarea: (
                <TextArea
                  autoFocus={autoFocusField === name}
                  className='w-full'
                  defaultValue={gameInfo[name]}
                  name={name}
                  resize='vertical'
                  rows={6}
                />
              ),
            }[type]
          }
        </label>
      ))}
    </div>
  )
}
