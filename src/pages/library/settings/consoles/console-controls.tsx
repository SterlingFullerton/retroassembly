import { Button, SegmentedControl } from '@radix-ui/themes'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConsole } from '#@/consoles/registry.ts'
import type { PlatformName } from '#@/constants/platform.ts'
import { bindConsoleButton } from '#@/input/console-buttons.ts'
import { bindConsoleKey, getHotkeyOn, type Hotkey } from '#@/input/console-keys.ts'
import { keyName } from '#@/input/hints.ts'
import { getPadButtons, getPadKeys } from '#@/input/pad.ts'
import type { RetroPadButton, RetroPadInput } from '#@/input/retropad.ts'
import { useSpatialNavigationPaused } from '#@/pages/library/atoms.ts'
import { PadView } from '#@/pages/library/components/emulator-portal/game-overlay/keyboard-pad.tsx'
import { useGamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getKeyNameFromCode } from '#@/pages/library/utils/keyboard.ts'
import { Gamepad } from '#@/utils/client/gamepad.ts'
import { GamepadTitle } from '../controls/gamepad-title.tsx'
import { SettingsTitle } from '../settings-title.tsx'

const hotkeyNames: Record<Hotkey, string> = {
  $pause: 'emulator.pause',
  input_hold_fast_forward: 'emulator.fastForward',
  input_rewind: 'emulator.rewind',
}

// The picture's width at full size, and the smallest it's drawn before it scrolls sideways instead
const padWidth = 768
const smallestScale = 0.6

// The messages under the picture, for keys and for a gamepad's buttons
const messages = {
  gamepad: {
    changed: 'settings.changedButtonsForConsole',
    press: 'settings.pressButtonFor',
    select: 'settings.selectButtonToChange',
  },
  keyboard: {
    changed: 'settings.changedForConsole',
    press: 'settings.pressKeyFor',
    select: 'settings.pressKeyToChange',
  },
}

/**
 * A console's controls: its controller as the pause menu draws it, each button on the key that plays it, or on the
 * button of the gamepad in use. Picking one on the picture and then pressing a key, or a gamepad button, gives it that
 * for this console only; the rest follow the layout shared by every console. Where there's less room than the picture
 * needs it's drawn smaller, and on a phone it also scrolls sideways
 */
export function ConsoleControls({ platform }: Readonly<{ platform: PlatformName }>) {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const { gamepad } = useGamepads()
  const gamepadMapping = useGamepadMapping()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()
  const [mode, setMode] = useState<'gamepad' | 'keyboard'>('keyboard')

  const console = resolveConsole(platform, preference.emulator.platform[platform].core)
  const shared: Record<string, string> = preference.input.keyboardMapping
  const ownKeys = preference.input.consoleKeys?.[platform]
  const gamepadId = gamepad?.id
  const ownButtons = gamepadId ? preference.input.consoleButtons?.[platform]?.[gamepadId] : undefined
  const own = mode === 'keyboard' ? ownKeys : ownButtons
  const hasOwn = Object.keys(own ?? {}).length > 0

  // The button waiting for a key or a gamepad button, and a key that was refused for it
  const [listening, setListening] = useState<{ input: RetroPadInput; label: string }>()
  const [refused, setRefused] = useState<{ hotkey: Hotkey; key: string }>()

  function stopListening() {
    setListening(undefined)
    setRefused(undefined)
  }

  // Saved as what's changed: what the console no longer has of its own is taken out, and with nothing left so is the
  // console, or the gamepad under it
  async function save(changes: Record<string, string>) {
    const removed = Object.keys(own ?? {}).filter((setting) => !(setting in changes))
    const kept = { ...changes, ...Object.fromEntries(removed.map((setting) => [setting, null])) }
    const snippet = Object.keys(changes).length > 0 ? kept : null
    stopListening()
    if (mode === 'keyboard') {
      await update({ input: { consoleKeys: { [platform]: snippet } } })
    } else if (gamepadId) {
      await update({ input: { consoleButtons: { [platform]: { [gamepadId]: snippet } } } })
    }
  }

  async function bind(value: string) {
    if (!listening || isLoading) {
      return
    }
    await save(
      mode === 'keyboard'
        ? bindConsoleKey({ console, own: ownKeys, shared }, listening.input, value)
        : bindConsoleButton({ gamepad: gamepadMapping, own: ownButtons }, listening.input as RetroPadButton, value),
    )
  }

  // While a button waits for a key, the next key is its key: nothing else on the page sees it. Escape gives up, here
  // and while it waits for a gamepad's button
  const handleKeyDown = useEffectEvent(async (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      stopListening()
      return
    }
    const key = getKeyNameFromCode(event.code)
    if (mode !== 'keyboard' || !key) {
      return
    }
    // A key that pauses, rewinds or fast-forwards every game can't also play a button
    const hotkey = getHotkeyOn(shared, key)
    if (hotkey) {
      setRefused({ hotkey, key })
      return
    }
    await bind(key)
  })
  const handleGamepadPress = useEffectEvent(async (event: { button: number; gamepad: { id: string } }) => {
    if (mode === 'gamepad' && event.gamepad.id === gamepadId) {
      await bind(`${event.button}`)
    }
  })
  const isListening = Boolean(listening)
  useEffect(() => {
    if (!isListening) {
      return
    }
    // The gamepad's buttons don't move around the page meanwhile
    setSpatialNavigationPaused(true)
    const abortController = new AbortController()
    globalThis.addEventListener('keydown', handleKeyDown, { capture: true, signal: abortController.signal })
    const offPress = Gamepad.onPress(handleGamepadPress)
    return () => {
      abortController.abort()
      offPress()
      setSpatialNavigationPaused(false)
    }
  }, [isListening, setSpatialNavigationPaused])

  const pad =
    mode === 'keyboard'
      ? getPadKeys(console, shared, { edit: true, own: ownKeys })
      : getPadButtons(console, gamepadMapping, { edit: true, own: ownButtons })
  const waitingForGamepad = mode === 'gamepad' && !gamepadId

  // The picture is drawn to fit the room it has
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!frame.current) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.max(smallestScale, Math.min(1, entry.contentRect.width / padWidth)))
    })
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div>
      <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
        <SettingsTitle as='h4' className='mb-0 text-base font-normal'>
          {t('settings.controls')}
          {mode === 'gamepad' && gamepadId ? (
            <span className='flex items-baseline gap-2 text-sm text-(--gray-11)'>
              <GamepadTitle id={gamepadId} />
            </span>
          ) : null}
        </SettingsTitle>
        <SegmentedControl.Root
          onValueChange={(value: typeof mode) => {
            stopListening()
            setMode(value)
          }}
          size='1'
          value={mode}
        >
          <SegmentedControl.Item value='keyboard'>
            <div className='flex items-center gap-2'>
              <span className='icon-[mdi--keyboard]' /> {t('common.keyboard')}
            </div>
          </SegmentedControl.Item>
          <SegmentedControl.Item value='gamepad'>
            <div className='flex items-center gap-2'>
              <span className='icon-[mdi--gamepad]' /> {t('common.gamepad')}
            </div>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      {/* Dark in either theme, as the picture is over a game */}
      <div className='overflow-x-auto rounded-2xl bg-neutral-900 px-4 py-6' data-sn-section='' ref={frame}>
        {waitingForGamepad ? (
          <div className='flex items-center justify-center gap-2 py-16 text-white/60'>
            <span className='icon-[svg-spinners--180-ring] shrink-0 text-2xl' />
            <span className='text-xl'>{t('gamepad.pressAnyKey')}</span>
          </div>
        ) : (
          <div className='mx-auto' style={{ width: padWidth, zoom: scale }}>
            <PadView
              edit={{
                listening: listening?.input,
                onPick: (input, label) => {
                  setRefused(undefined)
                  setListening(listening?.input === input ? undefined : { input, label })
                },
              }}
              pad={pad}
            />
          </div>
        )}
      </div>

      {waitingForGamepad ? null : (
        <div className='mt-2 flex min-h-8 flex-wrap items-center justify-between gap-2 text-sm' data-sn-section=''>
          {listening ? (
            <>
              <span aria-live='polite' className={refused ? 'text-(--red-11)' : undefined}>
                {refused
                  ? t('settings.keyUsedFor', { action: t(hotkeyNames[refused.hotkey]), key: keyName(refused.key) })
                  : t(messages[mode].press, { button: listening.label })}
              </span>
              <span className='flex gap-2'>
                <Button disabled={isLoading} onClick={() => bind('')} size='1' type='button' variant='soft'>
                  <span className='icon-[mdi--close]' />
                  {t('common.clear')}
                </Button>
                <Button onClick={stopListening} size='1' type='button' variant='soft'>
                  {t('common.cancel')}
                </Button>
              </span>
            </>
          ) : (
            <>
              <span className='flex items-center gap-2 text-(--gray-11)'>
                {hasOwn ? <span className='size-3 shrink-0 rounded-full bg-(--accent-9)' /> : null}
                {t(hasOwn ? messages[mode].changed : messages[mode].select)}
              </span>
              {hasOwn ? (
                <Button disabled={isLoading} onClick={() => save({})} size='1' type='button' variant='soft'>
                  <span className='icon-[mdi--undo]' />
                  {t('common.reset')}
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  )
}
