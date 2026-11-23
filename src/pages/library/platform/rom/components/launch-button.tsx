import { Button, type ButtonProps } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

/** What a Start button shows while its game loads */
export interface LaunchButtonProgress {
  /** From 0 to 1; left out while it can't be told, which shows moving stripes */
  fraction?: number
  /** The step, like "Loading" or "Starting" */
  label: string
  /** How far the step has got, like "Game: 312 of 980 MB" */
  detail?: string
}

interface LaunchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Smaller, for buttons side by side, as on Home */
  compact?: boolean
  /** Until a wide screen, a square holding only the button's icon; its name is still read out */
  iconOnly?: boolean
  /** Shares the row's whole width with the button beside it, rather than stopping at its usual width */
  stretch?: boolean
  progress?: LaunchButtonProgress
  variant?: ButtonProps['variant']
}

export function LaunchButton({
  children,
  compact = false,
  disabled,
  iconOnly = false,
  stretch = false,
  progress,
  variant = 'solid',
  ...props
}: Readonly<LaunchButtonProps>) {
  return (
    <button
      aria-busy={progress ? 'true' : undefined}
      aria-disabled={disabled ? 'true' : 'false'}
      className={clsx('launch-button group block', {
        'lg:max-w-56': compact && !stretch,
        'max-lg:w-12 max-lg:flex-none!': iconOnly,
        'min-w-0 flex-1': stretch || compact,
        'opacity-50': disabled && !progress,
        'w-full lg:w-80': !stretch && !compact,
      })}
      data-sn-enabled
      {...props}
      type='button'
    >
      <Button asChild radius='small' size='4' variant={variant}>
        <div
          className={clsx(
            'relative w-full! overflow-hidden transition-[filter,background-color]',
            compact ? 'h-12!' : 'h-16!',
            {
              'border-2! bg-(--color-background)! shadow-none! group-hover:bg-(--accent-2)!': variant === 'outline',
              'group-hover:brightness-110': variant !== 'outline',
            },
          )}
        >
          {progress ? (
            // The button fills as the game's files arrive
            <>
              <span className='absolute inset-0 bg-(--accent-3)' />
              <span
                className={clsx('absolute inset-y-0 left-0 bg-(--accent-6)', {
                  'launch-stripes': progress.fraction === undefined,
                })}
                style={{ width: `${(progress.fraction ?? 1) * 100}%` }}
              />
              <span aria-live='polite' className='relative flex flex-col items-center leading-tight text-(--accent-12)'>
                <span className={clsx('font-semibold', compact ? 'text-lg' : 'text-2xl')}>{progress.label}</span>
                {progress.detail ? <span className='text-xs font-medium tabular-nums'>{progress.detail}</span> : null}
              </span>
            </>
          ) : (
            children
          )}
        </div>
      </Button>
    </button>
  )
}
