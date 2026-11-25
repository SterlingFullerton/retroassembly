import { Button, Popover } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { orderedShaders, shaderOffPicture } from '#@/consoles/shaders.ts'
import { ShaderBar } from '#@/pages/library/components/shader-bar.tsx'

interface ShaderSwitcherProps {
  disabled?: boolean
  /** A console's shader that is the one for all consoles: said under its name, and Reset can't be pressed */
  inherited?: boolean
  label: ReactNode
  onChange: (shader: string) => unknown
  /** For a console's shader: has it use the one for all consoles again */
  onReset?: () => unknown
  /** The shader shown: its id, or '' for none */
  value: string
}

function indexOf(shader: string) {
  return Math.max(
    0,
    orderedShaders.findIndex(({ id }) => id === shader),
  )
}

/**
 * The shader setting: a row with the shader's name, like the settings around it. Pressing it opens the pause menu's
 * switcher beside it: the test card through the shader, arrows to the one before and after, and a bar of them all by
 * kind. A pick is saved once the presses stop, so going through several saves only the last, closed or not
 */
export function ShaderSwitcher({
  disabled,
  inherited,
  label,
  onChange,
  onReset,
  value,
}: Readonly<ShaderSwitcherProps>) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(() => indexOf(value))
  const indexRef = useRef(index)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The save waiting for the presses to stop, made when they were pressed, so it's for the setting they were pressed on
  const pendingSave = useRef<() => unknown>(undefined)

  function cancelSave() {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    pendingSave.current = undefined
  }

  // The setting changed elsewhere, or was saved: shown, unless presses are still waiting to be saved
  useEffect(() => {
    if (!saveTimer.current) {
      indexRef.current = indexOf(value)
      setIndex(indexRef.current)
    }
  }, [value])

  // Closing the settings at once after a press still saves it
  useEffect(
    () => () => {
      const save = pendingSave.current
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      pendingSave.current = undefined
      save?.()
    },
    [],
  )

  function step(direction: -1 | 1) {
    if (disabled) {
      return
    }
    indexRef.current = (indexRef.current + direction + orderedShaders.length) % orderedShaders.length
    setIndex(indexRef.current)
    const shader = orderedShaders[indexRef.current].id
    clearTimeout(saveTimer.current)
    pendingSave.current = () => onChange(shader)
    saveTimer.current = setTimeout(async () => {
      const save = pendingSave.current
      saveTimer.current = undefined
      pendingSave.current = undefined
      await save?.()
    }, 400)
  }

  // Reset wins over presses not yet saved
  async function reset() {
    cancelSave()
    await onReset?.()
  }

  // Left and right, from the keyboard or a gamepad (which presses the arrow keys in a popover)
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  const shader = orderedShaders[index]
  const name = shader.id ? shader.name : t('settings.shaderOff')
  const arrow =
    'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-(--gray-a3) disabled:cursor-default disabled:opacity-50'

  return (
    <div className='flex items-center justify-between gap-3'>
      {label}
      <div className='flex min-w-0 items-center gap-2'>
        {onReset ? (
          <Button
            color='gray'
            disabled={disabled || inherited}
            onClick={reset}
            size='1'
            title={t('settings.shaderSameAsAll')}
            type='button'
            variant='soft'
          >
            <span className='icon-[mdi--restore] size-3.5' />
            {t('common.reset')}
          </Button>
        ) : null}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              aria-label={`${t('settings.shader')}: ${name}`}
              className='min-w-0'
              color='gray'
              disabled={disabled}
              type='button'
              variant='soft'
            >
              <span className='truncate'>{name}</span>
              <span className='icon-[mdi--chevron-down] size-4 shrink-0' />
            </Button>
          </Popover.Trigger>
          <Popover.Content align='end' maxWidth='calc(100vw - 32px)' size='2' width='360px'>
            <div className='flex flex-col gap-3'>
              {/* The same size for every one: the card with no shader is far smaller, so it's scaled up too */}
              <img
                alt=''
                className={clsx('aspect-square w-full max-w-56 self-center rounded-md bg-black object-contain', {
                  '[image-rendering:pixelated]': !shader.id,
                })}
                src={shader.thumbnail || shaderOffPicture}
              />
              <div className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 rounded-2xl border border-solid border-(--gray-a6) p-1 transition-colors has-[button:focus-visible]:border-(--accent-8)'>
                <button
                  aria-label={t('settings.shaderPrevious')}
                  className={arrow}
                  onClick={() => step(-1)}
                  tabIndex={-1}
                  type='button'
                >
                  <span className='icon-[mdi--chevron-left] size-6' />
                </button>
                <button
                  aria-label={`${t('settings.shader')}: ${name}`}
                  className='flex min-w-0 cursor-pointer flex-col items-start rounded-lg px-1 py-1 text-left outline-none'
                  onClick={() => step(1)}
                  onKeyDown={handleKeyDown}
                  type='button'
                >
                  <span className='w-full truncate font-medium'>{name}</span>
                  <span className='w-full truncate text-xs text-(--gray-11)'>
                    {index + 1}
                    {inherited ? ` · ${t('settings.shaderSameAsAll')}` : ''}
                  </span>
                </button>
                <button
                  aria-label={t('settings.shaderNext')}
                  className={arrow}
                  onClick={() => step(1)}
                  tabIndex={-1}
                  type='button'
                >
                  <span className='icon-[mdi--chevron-right] size-6' />
                </button>
                <div className='col-span-3 px-3 pt-1 pb-2'>
                  <ShaderBar index={index} tone='theme' />
                </div>
              </div>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>
  )
}
