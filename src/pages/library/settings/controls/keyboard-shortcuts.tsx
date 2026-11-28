import { Button, TextField } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultPreference } from '#@/constants/preference.ts'
import { keyName } from '#@/input/hints.ts'
import {
  bindHotkey,
  bindNavigationKey,
  type HotkeyName,
  hotkeyNames,
  type NavigationKeyName,
  navigationKeyNames,
  playsGameButton,
} from '#@/input/navigation-keys.ts'
import { useInputMapping } from '#@/pages/library/hooks/use-input-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'
import { UpdateButton } from '../update-button.tsx'

type ShortcutName = HotkeyName | NavigationKeyName

const rows: { iconClass: string; label: string; name: ShortcutName }[][] = [
  [
    { iconClass: 'icon-[mdi--arrow-up]', label: 'input.up', name: '$up' },
    { iconClass: 'icon-[mdi--arrow-down]', label: 'input.down', name: '$down' },
    { iconClass: 'icon-[mdi--arrow-left]', label: 'input.left', name: '$left' },
    { iconClass: 'icon-[mdi--arrow-right]', label: 'input.right', name: '$right' },
    { iconClass: 'icon-[mdi--check]', label: 'common.confirm', name: '$confirm' },
    { iconClass: 'icon-[mdi--arrow-u-left-top]', label: 'common.cancel', name: '$cancel' },
  ],
  [
    { iconClass: 'icon-[mdi--pause]', label: 'emulator.pause', name: '$pause' },
    { iconClass: 'icon-[mdi--rewind]', label: 'emulator.rewind', name: 'input_rewind' },
    { iconClass: 'icon-[mdi--fast-forward]', label: 'emulator.fastForward', name: 'input_hold_fast_forward' },
  ],
]
const titles = ['nav.library', 'input.whilePlaying']

function isNavigationKey(name: ShortcutName): name is NavigationKeyName {
  return navigationKeyNames.includes(name as NavigationKeyName)
}

/**
 * The keyboard's keys that aren't a console's buttons: moving around the library, and pausing, rewinding and
 * fast-forwarding a game. A console's buttons are given keys on the console's own page
 */
export function KeyboardShortcuts() {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const { navigationKeys } = useInputMapping()
  const mapping: Record<string, null | string | undefined> = preference.input.keyboardMapping
  // A key a shortcut was refused, as it plays a game button
  const [refused, setRefused] = useState<{ key: string; name: ShortcutName }>()

  function valueOf(name: ShortcutName) {
    return isNavigationKey(name) ? navigationKeys[name] : (mapping[name] ?? '')
  }

  async function bind(name: ShortcutName, key: string) {
    if (isLoading) {
      return
    }
    if (!isNavigationKey(name) && playsGameButton(mapping, key, preference.input.consoleKeys)) {
      setRefused({ key, name })
      return
    }
    setRefused(undefined)
    const changes = isNavigationKey(name)
      ? bindNavigationKey(navigationKeys, name, key)
      : bindHotkey(mapping, name, key)
    await update({ input: { keyboardMapping: { ...mapping, ...changes } } })
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, name: ShortcutName) {
    // Tab still moves on
    if (event.key === 'Tab') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const key = getKeyNameFromCode(event.code)
    if (key) {
      await bind(name, key)
    }
  }

  const defaults: Record<string, string> = defaultPreference.input.keyboardMapping
  const reset = {
    ...mapping,
    ...Object.fromEntries(navigationKeyNames.map((name) => [name, null])),
    ...Object.fromEntries(hotkeyNames.map((name) => [name, defaults[name]])),
  }

  return (
    <div className='flex flex-col gap-4 py-2'>
      <div className='grid grid-cols-1 gap-x-10 lg:grid-cols-2'>
        {rows.map((group, index) => (
          <div key={titles[index]}>
            <div className='mb-1 text-xs font-semibold tracking-wider text-(--gray-11) uppercase max-lg:mt-4 max-lg:first:mt-0'>
              {t(titles[index])}
            </div>
            {group.map(({ iconClass, label, name }) => {
              const value = valueOf(name)
              return (
                <div className='border-b border-(--gray-4) py-1.5' key={name}>
                  <label className='flex items-center justify-between gap-3'>
                    <span className='flex min-w-0 items-center gap-2 text-sm'>
                      <span className='flex w-12 shrink-0 justify-center text-(--color-text)/70 max-[360px]:w-9'>
                        <span className={clsx('size-6', iconClass)} />
                      </span>
                      <span className='leading-tight break-words'>{t(label)}</span>
                    </span>
                    <TextField.Root
                      className='w-28 shrink-0 max-[360px]:w-24'
                      onChange={(event) => event.preventDefault()}
                      onFocus={(event) => event.target.select()}
                      onKeyDown={(event) => handleKeyDown(event, name)}
                      readOnly={isLoading}
                      size='2'
                      value={value}
                    >
                      <TextField.Slot />
                      <TextField.Slot>
                        {value ? (
                          <Button
                            className='-translate-x-1!'
                            onClick={() => bind(name, '')}
                            size='1'
                            title={t('common.clear')}
                            variant='ghost'
                          >
                            <span className='icon-[mdi--close]' />
                          </Button>
                        ) : null}
                      </TextField.Slot>
                    </TextField.Root>
                  </label>
                  {refused?.name === name ? (
                    <div className='mt-1 text-right text-xs text-(--red-11)' role='alert'>
                      {t('settings.keyPlaysGameButton', { key: keyName(refused.key) })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-xs text-(--gray-11)'>{t('settings.gameButtonsOnConsolePages')}</span>
        <UpdateButton preference={{ input: { keyboardMapping: reset } }}>
          <span className='icon-[mdi--undo]' />
          {t('emulator.resetToDefaults')}
        </UpdateButton>
      </div>
    </div>
  )
}
