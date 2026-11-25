import { Button, Select, TextField } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { type ReactNode, useEffect, useEffectEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { Gamepad } from '#@/utils/client/gamepad.ts'

interface GamepadInputProps {
  button: {
    iconClass?: string
    iconNode?: ReactNode
    name: string
    options?: readonly string[]
    shortcutPart?: 'key' | 'prefix'
    text?: string
  }
}

export function GamepadInput({ button }: Readonly<GamepadInputProps>) {
  const { t } = useTranslation()
  const { gamepad } = useGamepads()
  if (!gamepad?.id) {
    throw new Error('this should not happen')
  }
  const { isLoading, update } = usePreference()
  const textField = useRef(null)
  const gamepadMapping = useGamepadMapping()

  const value = getValue(gamepadMapping, button.name, button.shortcutPart)
  const options = getOptions(gamepadMapping, button)
  const disabled = button.name.startsWith('$') && !button.options
  const clearable = !disabled && Boolean(value)

  async function handleClickClear() {
    if (gamepad?.id) {
      await update({
        input: {
          gamepadMappings: {
            [gamepad.id]: {
              ...getPersistentMapping(gamepadMapping),
              [button.name]: null,
            },
          },
        },
      })
    }
  }

  async function handleValueChange(value: string) {
    if (!gamepad?.id || isLoading) {
      return
    }
    await update({
      input: {
        gamepadMappings: {
          [gamepad.id]: getUpdatedMapping(gamepadMapping, {
            name: button.name,
            shortcutPart: button.shortcutPart,
            value: value === 'none' ? '' : value,
          }),
        },
      },
    })
  }

  const handleGamepadPress = useEffectEvent(async (event: { button: number; gamepad: { id: string } }) => {
    if (textField.current !== document.activeElement || isLoading) {
      return
    }
    const persistentMapping = getPersistentMapping(gamepadMapping)
    const newMapping = { ...persistentMapping, [button.name]: `${event.button}` }
    const conflicts = Object.entries(persistentMapping).filter(
      ([key, code]) => code === `${event.button}` && key !== button.name,
    )
    for (const [conflict] of conflicts) {
      newMapping[conflict] = null
    }
    await update({ input: { gamepadMappings: { [event.gamepad.id]: newMapping } } })
  })

  useEffect(() => Gamepad.onPress(handleGamepadPress), [])

  return (
    <label className='flex items-center gap-2'>
      <div className='flex w-14 justify-end text-xs font-semibold text-(--color-text)/70'>
        {button.iconClass ? <span className={clsx('size-7', button.iconClass)} /> : button.iconNode}
      </div>
      <div>
        {button.options ? (
          <div>
            <Select.Root onValueChange={handleValueChange} value={value || 'none'}>
              <Select.Trigger disabled={isLoading} variant='surface' />
              <Select.Content>
                {options.map((option) => (
                  <Select.Item key={option || 'none'} value={option || 'none'}>
                    {option || t('common.disabled')}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </div>
        ) : (
          <TextField.Root
            className='w-28'
            disabled={disabled}
            inputMode='none'
            onBeforeInput={(event) => event.preventDefault()}
            onChange={(event) => event.preventDefault()}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => event.preventDefault()}
            readOnly={isLoading}
            ref={textField}
            size='2'
            value={value ?? ''}
          >
            <TextField.Slot />
            <TextField.Slot>
              {clearable ? (
                <Button className='-translate-x-1!' onClick={handleClickClear} size='1' title='Clear' variant='ghost'>
                  <span className='icon-[mdi--close]' />
                </Button>
              ) : null}
            </TextField.Slot>
          </TextField.Root>
        )}
        {button.text ? <span className='absolute mt-0.5 ml-2 text-xs opacity-50'>{button.text}</span> : null}
      </div>
    </label>
  )
}

interface GamepadShortcutMapping {
  $fast_forward: string
  $pause: string
  $rewind: string
  [key: string]: unknown
}

function getValue(mapping: GamepadShortcutMapping, name: string, shortcutPart?: 'key' | 'prefix') {
  if (name === '$fast_forward' && shortcutPart === 'prefix') {
    return getShortcut(mapping.$fast_forward).prefix
  }
  if ((name === '$fast_forward' || name === '$rewind') && shortcutPart === 'key') {
    return formatShortcut(getShortcut(mapping.$fast_forward).prefix, getShortcut(mapping[name]).key)
  }
  return typeof mapping[name] === 'string' ? mapping[name] : ''
}

function getOptions(
  mapping: GamepadShortcutMapping,
  { options = [], shortcutPart }: Pick<GamepadInputProps['button'], 'options' | 'shortcutPart'>,
) {
  if (shortcutPart !== 'key') {
    return options
  }
  const { prefix } = getShortcut(mapping.$fast_forward)
  return options.map((option) => formatShortcut(prefix, option))
}

function getUpdatedMapping(
  mapping: GamepadShortcutMapping,
  { name, shortcutPart, value }: { name: string; shortcutPart?: 'key' | 'prefix'; value: string },
) {
  const persistentMapping = getPersistentMapping(mapping)
  if (name === '$pause') {
    return { ...persistentMapping, $pause: value }
  }
  const fastForward = getShortcut(mapping.$fast_forward)
  const rewind = getShortcut(mapping.$rewind)
  if (name === '$fast_forward' && shortcutPart === 'prefix') {
    return {
      ...persistentMapping,
      $fast_forward: formatShortcut(value, fastForward.key),
      $rewind: formatShortcut(value, rewind.key),
    }
  }
  return {
    ...persistentMapping,
    [name]: formatShortcut(name === '$fast_forward' ? fastForward.prefix : rewind.prefix, getShortcut(value).key),
  }
}

function getPersistentMapping(mapping: GamepadShortcutMapping) {
  const {
    input_enable_hotkey: _inputEnableHotkey,
    input_enable_hotkey_btn: _inputEnableHotkeyButton,
    input_hold_fast_forward_btn: _inputHoldFastForwardButton,
    input_rewind_btn: _inputRewindButton,
    ...persistentMapping
  } = mapping
  return persistentMapping
}

function getShortcut(shortcut: string) {
  const [key, prefix] = shortcut.split(/\s+\+\s/u).toReversed()
  return { key, prefix: prefix || '' }
}

function formatShortcut(prefix: string, key: string) {
  return prefix ? `${prefix} + ${key}` : key
}
