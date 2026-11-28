import { clsx } from 'clsx'
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GameInputMessageItem } from '#@/pages/library/components/emulator-portal/game-overlay/game-input-message-item.tsx'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { useKeyboardMapping } from '#@/pages/library/hooks/use-keyboard-mapping.ts'

// The pause menu, the same for a game played on this device and one played on the server: a panel down the left with
// the game beside it, or a sheet from the bottom on an upright screen. A short list, with the rest a step away in
// pages of their own that open in the panel. What each item does is given by the game's side, so the menu itself knows
// nothing of emulators or the server

export type PauseMenuPage = 'controls' | 'exit' | 'load' | 'main' | 'settings' | 'together'

export interface PauseMenuAction {
  /** Set apart from the ones before it by a line */
  apart?: boolean
  icon: string
  label: string
  onClick: () => unknown
  testId?: string
}

interface PauseMenuProps {
  cover?: string
  /** The pages a step away. Play together's is left out where the game can't be shared */
  pages: { controls: ReactNode; load: ReactNode; settings: ReactNode; together?: ReactNode }
  exitActions: PauseMenuAction[]
  onBack: () => void
  onOpen: (page: Exclude<PauseMenuPage, 'main'>) => void
  onResume: () => unknown
  onSave: () => Promise<unknown>
  page: PauseMenuPage
  /** Everyone in a game on the server, this player among them */
  players?: number
  saveCount?: number
  /** Whether the game has snapshots to save and load: a linked console on the server has none */
  snapshots?: boolean
  title: string
  where: 'device' | 'server'
}

// The focus box is drawn by the item itself, filled with the accent, so the shared one is hidden here
const focusStyle = JSON.stringify({ opacity: 0 })
const itemClass =
  'pause-item flex min-h-11 w-full shrink-0 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-white/90 outline-none transition-colors hover:bg-white/10 focus:bg-(--accent-9) focus:text-white focus:shadow-[0_6px_18px_color-mix(in_srgb,var(--accent-9)_45%,transparent)] disabled:opacity-50'

/** One item of the menu or of a page: an icon, its name, and what's at its end */
export function PauseMenuItem({
  className,
  disabled,
  end,
  icon,
  label,
  onClick,
  testId,
}: Readonly<{
  className?: string
  disabled?: boolean
  end?: ReactNode
  icon: string
  label: ReactNode
  onClick: () => unknown
  testId?: string
}>) {
  return (
    <button
      className={clsx(itemClass, className)}
      data-sn-enabled
      data-sn-focus-style={focusStyle}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type='button'
    >
      <span className={clsx('size-5 shrink-0', icon)} />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {end === undefined ? null : <span className='flex shrink-0 items-center gap-1 text-xs opacity-60'>{end}</span>}
    </button>
  )
}

/** Something drawn at its own size, such as a console's controller, made smaller to fit the panel's width */
export function FitToWidth({ children }: Readonly<{ children: ReactNode }>) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ height: 0, scale: 1 })

  useEffect(() => {
    const box = outer.current
    const content = inner.current
    if (!box || !content) {
      return
    }
    // Scaled by a transform, which leaves the content's own size as it is to be measured
    function measure() {
      if (box && content) {
        const scale = content.offsetWidth > 0 ? Math.min(1, box.clientWidth / content.offsetWidth) : 1
        setFit({ height: content.offsetHeight * scale, scale })
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return (
    <div className='w-full min-w-0 overflow-hidden' ref={outer} style={{ height: fit.height || undefined }}>
      <div className='w-max origin-top-left' ref={inner} style={{ transform: `scale(${fit.scale})` }}>
        {children}
      </div>
    </div>
  )
}

function Divider() {
  return <div className='mx-1 my-1 h-px shrink-0 bg-white/10' />
}

const focusable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const chevron = <span className='icon-[mdi--chevron-right] size-4' />

type Saving = 'failed' | 'idle' | 'saved' | 'saving'

/** The keys that move in the menu, at the foot of the panel. Not on a touch screen, which has none */
function MenuKeys({ onPage }: Readonly<{ onPage: boolean }>) {
  const { t } = useTranslation()
  const keyboard = useKeyboardMapping()
  const { connected } = useGamepads()
  if (connected) {
    return null
  }
  return (
    <div className='pause-keys mt-auto hidden shrink-0 flex-wrap gap-x-4 gap-y-2 pt-2 text-xs text-white/70 [@media(pointer:fine)]:flex'>
      <GameInputMessageItem keyNames={['↑↓']}>{t('pauseMenu.move')}</GameInputMessageItem>
      <GameInputMessageItem keyNames={['enter']}>{t('pauseMenu.choose')}</GameInputMessageItem>
      <GameInputMessageItem keyNames={[keyboard.$pause]}>
        {onPage ? t('common.back') : t('game.resume')}
      </GameInputMessageItem>
    </div>
  )
}

export function PauseMenu({
  cover,
  exitActions,
  onBack,
  onOpen,
  onResume,
  onSave,
  page,
  pages,
  players,
  saveCount,
  snapshots = true,
  title,
  where,
}: Readonly<PauseMenuProps>) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState<Saving>('idle')
  // The exit item that's under way, such as a save before exiting, which can take a few seconds. The others wait for it
  const [exiting, setExiting] = useState<string>()
  const root = useRef<HTMLDivElement>(null)

  // A dialog: the focus goes back where it was when the menu closes, unless the game has already put it somewhere
  useEffect(() => {
    const before = document.activeElement
    const menu = root.current
    return () => {
      const now = document.activeElement
      const lost = !now || now === document.body || Boolean(menu?.contains(now))
      if (lost && before instanceof HTMLElement && before !== document.body && before.isConnected) {
        before.focus({ preventScroll: true })
      }
    }
  }, [])

  // Tab goes round the panel's own items, never out to the page behind the game
  function keepFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return
    }
    const items = [...(root.current?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter(
      (item) => item.getClientRects().length > 0,
    )
    const first = items.at(0)
    const last = items.at(-1)
    if (!first || !last) {
      event.preventDefault()
      return
    }
    const inside = root.current?.contains(document.activeElement)
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault()
      first.focus()
    }
  }

  async function runExit(action: PauseMenuAction) {
    if (exiting !== undefined) {
      return
    }
    setExiting(action.label)
    try {
      await action.onClick()
    } finally {
      setExiting(undefined)
    }
  }

  // "Saved" for a moment, then the item is itself again; a failure is said a little longer, to be read
  useEffect(() => {
    if (saving !== 'saved' && saving !== 'failed') {
      return
    }
    const timer = setTimeout(() => setSaving('idle'), saving === 'failed' ? 5000 : 2000)
    return () => clearTimeout(timer)
  }, [saving])

  async function save() {
    if (saving === 'saving') {
      return
    }
    setSaving('saving')
    try {
      await onSave()
      setSaving('saved')
    } catch {
      setSaving('failed')
    }
  }

  const saveLabel = {
    failed: t('emulator.snapshotFailed'),
    idle: t('common.save'),
    saved: t('pauseMenu.saved'),
    saving: t('pauseMenu.saving'),
  }[saving]
  const saveIcon = {
    failed: 'icon-[mdi--alert-circle]',
    idle: 'icon-[mdi--content-save]',
    saved: 'icon-[mdi--check]',
    saving: 'icon-[svg-spinners--180-ring]',
  }[saving]

  const pageTitles: Record<Exclude<PauseMenuPage, 'main'>, string> = {
    controls: t('pauseMenu.controls'),
    exit: t('common.exit'),
    load: t('pauseMenu.load'),
    settings: t('nav.settings'),
    together: t('pauseMenu.playTogether'),
  }

  const whereText = where === 'server' ? t('pauseMenu.onTheServer') : t('pauseMenu.onThisDevice')
  const playersText = players && players > 1 ? t('pauseMenu.players', { count: players }) : ''

  return (
    // A dialog over the game, which holds the keyboard's focus while it's open: Tab is kept to its own items
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keys are the dialog's, not a control's
    <div
      aria-label={title}
      aria-modal='true'
      className={clsx(
        'pause-menu absolute inset-0 flex',
        'landscape:bg-linear-to-r landscape:from-black/55 landscape:to-black/25',
        'portrait:flex-col portrait:justify-end portrait:bg-black/30',
      )}
      data-sn-section=''
      data-testid='pause-menu'
      onKeyDown={keepFocus}
      ref={root}
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <dialog> brings its own Escape and styles, where the menu has its own Back
      role='dialog'
    >
      <div
        className={clsx(
          'pause-panel flex min-h-0 flex-col gap-4 overflow-y-auto bg-neutral-900/80 text-white backdrop-blur-xl',
          'landscape:pl-safe-offset-5 landscape:py-safe-offset-6 landscape:h-full landscape:w-[min(30rem,45%)] landscape:min-w-80 landscape:border-r landscape:border-white/10 landscape:pr-5',
          'portrait:pb-safe-offset-5 portrait:max-h-[85%] portrait:w-full portrait:rounded-t-2xl portrait:px-4 portrait:pt-3',
        )}
      >
        <div className='mx-auto h-1 w-9 shrink-0 rounded-full bg-white/30 landscape:hidden' />

        {page === 'main' ? (
          <>
            <div className='flex shrink-0 items-center gap-3'>
              {cover ? <img alt='' className='h-12 w-16 shrink-0 rounded object-contain' src={cover} /> : null}
              <div className='min-w-0'>
                <div className='truncate text-lg leading-tight font-semibold'>{title}</div>
                <div className='mt-1 flex items-center gap-1.5 text-xs text-white/75' data-testid='pause-menu-where'>
                  <span
                    className={clsx(
                      'size-3.5 shrink-0',
                      where === 'server' ? 'icon-[mdi--server]' : 'icon-[mdi--monitor-cellphone]',
                    )}
                  />
                  {playersText
                    ? t('pauseMenu.whereWithPlayers', { players: playersText, where: whereText })
                    : whereText}
                </div>
              </div>
            </div>

            <div className='flex shrink-0 flex-col gap-0.5'>
              <PauseMenuItem
                className='pause-item-resume'
                icon='icon-[mdi--play]'
                label={t('game.resume')}
                onClick={onResume}
              />
              {snapshots ? (
                <>
                  <PauseMenuItem icon={saveIcon} label={saveLabel} onClick={save} testId='pause-save' />
                  <PauseMenuItem
                    className='pause-item-load'
                    end={
                      <>
                        {saveCount || null}
                        {chevron}
                      </>
                    }
                    icon='icon-[mdi--history]'
                    label={t('pauseMenu.load')}
                    onClick={() => onOpen('load')}
                    testId='pause-load'
                  />
                </>
              ) : null}
              <Divider />
              <PauseMenuItem
                className='pause-item-controls'
                end={chevron}
                icon='icon-[mdi--gamepad-variant]'
                label={t('pauseMenu.controls')}
                onClick={() => onOpen('controls')}
              />
              {pages.together ? (
                <PauseMenuItem
                  className='pause-item-together'
                  end={chevron}
                  icon='icon-[mdi--account-multiple]'
                  label={t('pauseMenu.playTogether')}
                  onClick={() => onOpen('together')}
                />
              ) : null}
              <PauseMenuItem
                className='pause-item-settings'
                end={chevron}
                icon='icon-[mdi--cog]'
                label={t('nav.settings')}
                onClick={() => onOpen('settings')}
              />
              <Divider />
              <PauseMenuItem
                className='pause-item-exit'
                end={chevron}
                icon='icon-[mdi--exit-to-app]'
                label={t('common.exit')}
                onClick={() => onOpen('exit')}
                testId='pause-exit'
              />
            </div>
          </>
        ) : (
          <>
            <div className='flex shrink-0 flex-col gap-1'>
              <button
                className='pause-back flex w-fit items-center gap-1 rounded-md py-1 pr-2 text-sm text-white/65 outline-none hover:text-white focus:bg-(--accent-9) focus:text-white'
                data-sn-enabled
                data-sn-focus-style={focusStyle}
                onClick={onBack}
                type='button'
              >
                <span className='icon-[mdi--chevron-left] size-4' />
                <span className='max-w-60 truncate'>{title}</span>
              </button>
              <h2 className='text-lg font-semibold'>{pageTitles[page]}</h2>
            </div>
            {page === 'exit' ? (
              <div className='pause-page-body flex shrink-0 flex-col gap-0.5'>
                {exitActions.map((action) => (
                  <Fragment key={action.label}>
                    {action.apart ? <Divider /> : null}
                    <PauseMenuItem
                      // Not disabled, which would take the focus from the chosen item: a second press waits all the same
                      className={exiting !== undefined && exiting !== action.label ? 'opacity-50' : undefined}
                      icon={exiting === action.label ? 'icon-[svg-spinners--180-ring]' : action.icon}
                      label={action.label}
                      onClick={() => runExit(action)}
                      testId={action.testId}
                    />
                  </Fragment>
                ))}
              </div>
            ) : (
              <div className='pause-page-body flex min-h-0 shrink-0 flex-col gap-4'>{pages[page]}</div>
            )}
          </>
        )}

        <MenuKeys onPage={page !== 'main'} />
      </div>

      <div className='top-safe-offset-3 right-safe-offset-3 pointer-events-none absolute flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-xs tracking-widest text-white uppercase portrait:hidden'>
        <span className='icon-[mdi--pause] size-3.5' />
        {t('pauseMenu.paused')}
      </div>
    </div>
  )
}

/** Puts the focus where a page starts: its first item, else its way back; on the menu, the item that opened the page */
export function focusPauseMenu(page: PauseMenuPage, from?: PauseMenuPage) {
  const selector =
    page === 'main' ? `.pause-item-${from && from !== 'main' ? from : 'resume'}` : '.pause-page-body [data-sn-enabled]'
  const target =
    document.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>('.pause-panel .pause-back')
  target?.focus({ preventScroll: true })
}
