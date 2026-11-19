import { Select, TextArea, TextField } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { range } from 'es-toolkit'
import { DateTime } from 'luxon'
import { type ChangeEvent, type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDate } from '#@/pages/library/hooks/use-date.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'

// Enter in a field doesn't save the window: only Save does
function ignoreEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault()
  }
}

export function GameInfoDataList({ autoFocusField }: Readonly<{ autoFocusField?: string }>) {
  const { t } = useTranslation()
  const rom = useRom()
  const { dateFormat, formatDate, isValidDate } = useDate()
  const example = formatDate('1990-03-15')
  const [dateInvalid, setDateInvalid] = useState(false)

  // A date the server couldn't read is refused before Save, as it's typed
  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    const { value } = event.currentTarget
    const invalid = Boolean(value.trim()) && !DateTime.fromFormat(value.trim(), dateFormat).isValid
    event.currentTarget.setCustomValidity(invalid ? t('game.dateFormat', { example, interpolation: { escapeValue: false } }) : '')
    setDateInvalid(invalid)
  }

  const dataListFields = [
    {
      // Empty, the title comes from the file name, shown as the hint
      label: t('common.name'),
      name: 'gameTitle',
      placeholder: getRomGoodcodes({ ...rom, gameTitle: null }).rom,
      type: 'input' as const,
    },
    {
      label: t('common.released'),
      name: 'gameReleaseDate',
      placeholder: example,
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

  // What's stored for the game, which includes what was found for it when it was added. The description isn't stored
  // then, so it still comes from LaunchBox until one is saved
  const gameInfo = {
    gameDescription: rom.gameDescription ?? rom.rawGameMetadata?.launchbox?.overview,
    gameDeveloper: rom.gameDeveloper,
    gameGenres: rom.gameGenres,
    gamePlayers: Math.trunc(Number(rom.gamePlayers)) ? `${rom.gamePlayers}` : 'unknown',
    gamePublisher: rom.gamePublisher,
    gameReleaseDate: rom.gameReleaseDate && isValidDate(rom.gameReleaseDate) ? formatDate(rom.gameReleaseDate) : '',
    gameTitle: rom.gameTitle,
  }

  // Name across; Released and Players, Developer and Publisher side by side where there's room; Genres and Description across
  const wide = new Set(['gameDescription', 'gameGenres', 'gameTitle'])

  return (
    <div className='grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2'>
      {dataListFields.map(({ label, name, options, type, ...valueProps }) => (
        <label className={clsx('flex flex-col gap-1', { 'sm:col-span-2': wide.has(name) })} key={name}>
          <span className='text-xs text-(--gray-11)'>{label}</span>
          {
            {
              input: (
                <TextField.Root
                  aria-invalid={name === 'gameReleaseDate' && dateInvalid ? true : undefined}
                  autoFocus={autoFocusField === name}
                  color={name === 'gameReleaseDate' && dateInvalid ? 'red' : undefined}
                  defaultValue={gameInfo[name] ?? ''}
                  name={name}
                  onChange={name === 'gameReleaseDate' ? handleDateChange : undefined}
                  onKeyDown={ignoreEnter}
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
          {name === 'gameReleaseDate' && dateInvalid ? (
            <span className='text-xs text-(--red-11)'>{t('game.dateFormat', { example, interpolation: { escapeValue: false } })}</span>
          ) : null}
        </label>
      ))}
    </div>
  )
}
