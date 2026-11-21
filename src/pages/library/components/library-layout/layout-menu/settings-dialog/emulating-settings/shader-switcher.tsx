import { Button } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { type ReactNode, useEffect, useRef, useState } from 'react'
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
 * The shader setting, as the pause menu has it: the test card through the shader, its name and place, arrows to the one
 * before and after, and a bar of them all by kind. A pick is saved once the presses stop, so going through several
 * saves only the last
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
  const control = useRef<HTMLButtonElement>(null)

  // The setting changed elsewhere, or was saved: shown, unless presses are still waiting to be saved
  useEffect(() => {
    if (!saveTimer.current) {
      indexRef.current = indexOf(value)
      setIndex(indexRef.current)
    }
  }, [value])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  function step(direction: -1 | 1) {
    if (disabled) {
      return
    }
    indexRef.current = (indexRef.current + direction + orderedShaders.length) % orderedShaders.length
    setIndex(indexRef.current)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = undefined
      await onChange(orderedShaders[indexRef.current].id)
    }, 400)
  }

  // Left and right from a gamepad or the keyboard, on the focused control, as the volume's slider takes them
  useEffect(() => {
    const element = control.current
    if (!element) {
      return
    }
    function handleAdjust(event: Event) {
      step(event instanceof CustomEvent && event.detail === 'left' ? -1 : 1)
    }
    element.addEventListener('sn:adjust', handleAdjust)
    return () => element.removeEventListener('sn:adjust', handleAdjust)
  })

  const shader = orderedShaders[index]
  const name = shader.id ? shader.name : t('settings.shaderOff')
  const arrow =
    'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-(--gray-a3) disabled:cursor-default disabled:opacity-50'

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-3'>
        {label}
        {onReset ? (
          <Button
            className='game-shader-reset'
            color='gray'
            disabled={disabled || inherited}
            onClick={onReset}
            size='1'
            title={t('settings.shaderSameAsAll')}
            type='button'
            variant='soft'
          >
            <span className='icon-[mdi--restore] size-3.5' />
            {t('common.reset')}
          </Button>
        ) : null}
      </div>

      {/* The same size for every one: the card with no shader is far smaller, so it's scaled up too */}
      <img
        alt=''
        className={clsx('aspect-square w-full max-w-56 self-center rounded-md bg-black object-contain', {
          '[image-rendering:pixelated]': !shader.id,
        })}
        src={shader.thumbnail || shaderOffPicture}
      />

      <div
        className={clsx(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 rounded-2xl border border-solid border-(--gray-a6) p-1',
          'transition-colors has-[button[data-sn-adjust]:focus-visible]:border-(--accent-8)',
          { 'opacity-60': disabled },
        )}
      >
        {/* One grid, so the panel is the control's parent and the focus is drawn around all of it, bar and all */}
        <button
          aria-label={t('settings.shaderPrevious')}
          className={arrow}
          disabled={disabled}
          onClick={() => step(-1)}
          tabIndex={-1}
          type='button'
        >
          <span className='icon-[mdi--chevron-left] size-6' />
        </button>
        <button
          aria-label={`${t('settings.shader')}: ${name}`}
          className='flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-lg px-1 py-1 text-left outline-none'
          data-sn-adjust
          data-sn-focus-parent
          // Reset is above, off to the side: up reaches it while it can be used
          data-sn-up={onReset && !inherited ? '.game-shader-reset' : undefined}
          disabled={disabled}
          onClick={() => step(1)}
          ref={control}
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
          disabled={disabled}
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
  )
}
