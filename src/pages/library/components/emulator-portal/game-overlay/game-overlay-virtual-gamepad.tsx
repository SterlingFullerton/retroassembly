import { clsx } from 'clsx'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { twMerge } from 'tailwind-merge'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useEmulator } from '../hooks/use-emulator.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { ColecoVisionControls } from './colecovision-controls.tsx'
import { GenesisControls } from './genesis-controls.tsx'
import { N64Controls } from './n64-controls.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'
import { getVirtualGamepadLabels, type VirtualGamepadLabelButton } from './virtual-gamepad-labels.ts'

type HoldCommand = 'FAST_FORWARD_HOLD' | 'REWIND'

async function waitForAnimationFrame() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

interface VirtualGamepadCommandButtonProps {
  children: ReactNode
  className?: string
  command: HoldCommand
  title: string
}

function VirtualGamepadCommandButton({
  children,
  className,
  command,
  title,
}: Readonly<VirtualGamepadCommandButtonProps>) {
  const { emulator } = useEmulator()
  const commandLoop = useRef<Promise<void> | undefined>(undefined)
  const pressing = useRef(false)

  async function runCommandLoop() {
    while (pressing.current) {
      await waitForAnimationFrame()
      if (pressing.current) {
        emulator?.sendCommand(command)
      }
    }
  }

  function handleVirtualPressStart() {
    if (pressing.current) {
      return
    }

    pressing.current = true
    commandLoop.current = runCommandLoop()
  }

  function handleVirtualPressEnd() {
    pressing.current = false
  }

  useEffect(
    () => () => {
      pressing.current = false
    },
    [],
  )

  return (
    <VirtualGamepadButton
      className={className}
      onVirtualPressEnd={handleVirtualPressEnd}
      onVirtualPressStart={handleVirtualPressStart}
      title={title}
    >
      {children}
    </VirtualGamepadButton>
  )
}

// Sizes the game to the space above the on-screen controls, so they don't cover the DS touchscreen, or to the whole
// screen while they're hidden. Only the element's CSS height is set: RetroArch sizes the picture from it in device
// pixels, and resizing the picture here as well leaves the two out of step, which zooms the game in.
function useFitGameAboveControls(enabled: boolean, controls: RefObject<HTMLDivElement | null>) {
  const { emulator } = useEmulator()

  useEffect(() => {
    const canvas = emulator?.getCanvas()
    if (!enabled || !emulator || !canvas) {
      return
    }

    function fit() {
      if (!emulator || !canvas) {
        return
      }
      const rect = controls.current?.getBoundingClientRect()
      const viewportHeight = globalThis.visualViewport?.height ?? globalThis.innerHeight
      // In landscape the controls are at the sides, so the game has the whole height
      const landscape = globalThis.matchMedia('(orientation: landscape)').matches
      const height = Math.floor(
        rect && rect.height > 0 && !landscape ? Math.min(viewportHeight, rect.top) : viewportHeight,
      )
      if (canvas.offsetHeight !== height) {
        canvas.style.height = `${height}px`
      }
    }

    fit()
    // The emulator's startup resize leaves RetroArch drawing for a different canvas size; a resize event makes it measure again
    globalThis.dispatchEvent(new Event('resize'))
    const abortController = new AbortController()
    globalThis.addEventListener('resize', fit, { signal: abortController.signal })
    globalThis.visualViewport?.addEventListener('resize', fit, { signal: abortController.signal })
    // Fit again whenever the canvas or the controls change size
    const resizeObserver = new ResizeObserver(fit)
    for (const element of [canvas, controls.current]) {
      if (element) {
        resizeObserver.observe(element)
      }
    }
    return () => {
      abortController.abort()
      resizeObserver.disconnect()
      canvas.style.height = '100%'
    }
  }, [enabled, emulator, controls])
}

// On DS in portrait the controls fill one strip under the game: L and R in its top corners with Select and Start
// between them, and the d-pad and the face buttons on either side. In landscape the game takes the whole height and the
// controls go to its sides, as on the N64: L and R up top, the d-pad low on the left, the face buttons low on the right,
// and Select and Start beside pause in the top left. Flat, translucent buttons turn white while pressed.
const dsButton = 'bg-white/9 text-white/80 data-[touching=true]:bg-white/85 data-[touching=true]:text-black'
const dsDiagonal = 'bg-transparent data-[touching=true]:bg-white/20'

function DSControls({
  controls,
  visible,
}: Readonly<{
  controls: RefObject<HTMLDivElement | null>
  visible: boolean
}>) {
  return (
    <div
      className={twMerge(
        'bottom-safe absolute inset-x-0 h-47',
        // Covers the whole screen in landscape, so only its buttons take touches: the game's touchscreen is between them
        'landscape:top-safe landscape:pointer-events-none landscape:h-auto landscape:*:pointer-events-auto',
        clsx({ hidden: !visible }),
      )}
      ref={controls}
    >
      <VirtualGamepadButton
        buttonName='l'
        className={twMerge(
          dsButton,
          'absolute top-0 left-0 h-7.5 w-30 rounded-br-2xl',
          'landscape:left-safe-offset-3 landscape:top-14 landscape:h-9 landscape:w-36 landscape:rounded-2xl',
        )}
      >
        L
      </VirtualGamepadButton>
      <VirtualGamepadButton
        buttonName='r'
        className={twMerge(
          dsButton,
          'absolute top-0 right-0 h-7.5 w-30 rounded-bl-2xl',
          'landscape:right-safe-offset-3 landscape:top-14 landscape:h-9 landscape:w-36 landscape:rounded-2xl',
        )}
      >
        R
      </VirtualGamepadButton>

      <div
        className={twMerge(
          'absolute top-0.75 left-1/2 flex -translate-x-1/2 gap-1.5',
          // In landscape: top left, beside pause, as on the N64
          'landscape:left-safe-offset-10 landscape:top-1 landscape:translate-x-0',
        )}
      >
        <VirtualGamepadButton buttonName='select' className={twMerge(dsButton, 'h-6 w-13 rounded-full text-[11px]')}>
          Select
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='start' className={twMerge(dsButton, 'h-6 w-13 rounded-full text-[11px]')}>
          Start
        </VirtualGamepadButton>
      </div>

      {/* A cross of four arms around a centre; the empty corners press two directions at once */}
      <div
        className={twMerge(
          'absolute top-10.5 left-2.5 grid size-33 grid-cols-3 grid-rows-3',
          'landscape:left-safe-offset-4 landscape:top-auto landscape:bottom-14',
        )}
      >
        <VirtualGamepadButton
          buttonNames={['up', 'left']}
          className={twMerge(dsDiagonal, 'rounded-tl-2xl')}
          group='dpad'
          title='up,left'
        />
        <VirtualGamepadButton buttonName='up' className={twMerge(dsButton, 'rounded-t-lg')} group='dpad' title='up'>
          <span className='icon-[mdi--menu-up] size-6' />
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonNames={['right', 'up']}
          className={twMerge(dsDiagonal, 'rounded-tr-2xl')}
          group='dpad'
          title='right,up'
        />
        <VirtualGamepadButton buttonName='left' className={twMerge(dsButton, 'rounded-l-lg')} group='dpad' title='left'>
          <span className='icon-[mdi--menu-left] size-6' />
        </VirtualGamepadButton>
        <div className='grid place-items-center bg-white/9'>
          <div className='size-5 rounded-full bg-black/35' />
        </div>
        <VirtualGamepadButton
          buttonName='right'
          className={twMerge(dsButton, 'rounded-r-lg')}
          group='dpad'
          title='right'
        >
          <span className='icon-[mdi--menu-right] size-6' />
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonNames={['left', 'down']}
          className={twMerge(dsDiagonal, 'rounded-bl-2xl')}
          group='dpad'
          title='left,down'
        />
        <VirtualGamepadButton buttonName='down' className={twMerge(dsButton, 'rounded-b-lg')} group='dpad' title='down'>
          <span className='icon-[mdi--menu-down] size-6' />
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonNames={['right', 'down']}
          className={twMerge(dsDiagonal, 'rounded-br-2xl')}
          group='dpad'
          title='right,down'
        />
      </div>

      <div
        className={twMerge(
          'absolute top-10.5 right-2.5 grid size-33 grid-cols-3 grid-rows-3 font-semibold *:size-11 *:rounded-full',
          'landscape:right-safe-offset-4 landscape:top-auto landscape:bottom-14',
        )}
      >
        <VirtualGamepadButton buttonName='x' className={twMerge(dsButton, 'col-start-2 row-start-1')} group='face'>
          X
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='y' className={twMerge(dsButton, 'col-start-1 row-start-2')} group='face'>
          Y
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='a' className={twMerge(dsButton, 'col-start-3 row-start-2')} group='face'>
          A
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='b' className={twMerge(dsButton, 'col-start-2 row-start-3')} group='face'>
          B
        </VirtualGamepadButton>
      </div>
    </div>
  )
}

// X, Y, A and B around a diamond, by their grid cells
const faceButtons: [VirtualGamepadLabelButton & ('a' | 'b' | 'x' | 'y'), string][] = [
  ['x', 'col-start-2 row-start-1'],
  ['y', 'col-start-1 row-start-2'],
  ['a', 'col-start-3 row-start-2'],
  ['b', 'col-start-2 row-start-3'],
]

export function GameOverlayVirtualGamepad() {
  const { connected } = useGamepads()
  const [gamepadVisible, setGamepadVisible] = useState(!connected)
  const { show } = useGameOverlay()
  const [launched] = useEmulatorLaunched()
  const rom = useRom()
  const { preference } = usePreference()
  const rewindEnabled = rom ? preference.emulator.platform[rom.platform].rewindEnabled : true
  const { t } = useTranslation()
  const isDS = rom?.platform === 'nds'
  const isN64 = rom?.platform === 'n64'
  const isColecoVision = rom?.platform === 'colecovision'
  const [keypadOpen, setKeypadOpen] = useState(false)
  const closeKeypad = useCallback(() => setKeypadOpen(false), [])
  // Arcade games take a coin with Select
  const isArcade = rom?.platform === 'arcade'
  const { core } = useEmulator()
  // Drawn like its controller with the emulator whose buttons are known; PicoDrive keeps the generic layout
  const isGenesis = (rom?.platform === 'genesis' || rom?.platform === 'megadrive') && core === 'genesis_plus_gx'
  // Each system's own names for the buttons; null hides a button its emulator does nothing with
  const labels = getVirtualGamepadLabels(rom?.platform, core)
  const dsControls = useRef<HTMLDivElement>(null)
  useFitGameAboveControls(launched && isDS, dsControls)

  if (!launched) {
    return
  }

  return (
    <div
      className={twMerge(
        'fixed inset-0 block touch-none lg:hidden',
        // The DS bottom screen is a touchscreen, so touches outside the buttons must reach the game
        clsx({ 'pointer-events-none! *:pointer-events-auto': isDS }),
      )}
    >
      <div className='top-safe p-x-2 absolute inset-x-0 flex'>
        <VirtualGamepadButton
          className={twMerge('left-safe absolute rounded p-2', clsx({ hidden: !gamepadVisible }))}
          onClick={async () => await show()}
        >
          <span className='icon-[mdi--pause]' />
        </VirtualGamepadButton>
        {/* The ColecoVision's keypad opens from beside pause */}
        {isColecoVision ? (
          <VirtualGamepadButton
            className={twMerge(
              'left-safe-offset-10 absolute rounded p-2',
              clsx({ 'bg-[#ff9a4a] text-[#3a1a00]': keypadOpen, hidden: !gamepadVisible }),
            )}
            onClick={() => setKeypadOpen(!keypadOpen)}
            title='Keypad'
          >
            <span className='icon-[mdi--dialpad]' />
          </VirtualGamepadButton>
        ) : null}

        {/* Rewind and fast forward aren't buttons of the console, so they sit up here with pause rather than among its
            controls */}
        <div className='right-safe absolute flex gap-1'>
          {rewindEnabled ? (
            <VirtualGamepadCommandButton
              className={twMerge('rounded p-2', clsx({ hidden: !gamepadVisible }))}
              command='REWIND'
              title='Rewind'
            >
              <span className='icon-[mdi--rewind]' />
            </VirtualGamepadCommandButton>
          ) : null}
          <VirtualGamepadCommandButton
            className={twMerge('rounded p-2', clsx({ hidden: !gamepadVisible }))}
            command='FAST_FORWARD_HOLD'
            title='Fast forward'
          >
            <span className='icon-[mdi--fast-forward]' />
          </VirtualGamepadCommandButton>
          <VirtualGamepadButton
            className='rounded p-2'
            onClick={() => setGamepadVisible(!gamepadVisible)}
            title='Toggle gamepad'
          >
            <span className='icon-[mdi--gamepad-square]' />
          </VirtualGamepadButton>
        </div>
      </div>

      {isDS ? <DSControls controls={dsControls} visible={gamepadVisible} /> : null}
      {isN64 ? <N64Controls visible={gamepadVisible} /> : null}
      {isColecoVision ? (
        <ColecoVisionControls keypadOpen={keypadOpen} onKeypadClose={closeKeypad} visible={gamepadVisible} />
      ) : null}
      {isGenesis ? <GenesisControls visible={gamepadVisible} /> : null}
      {isDS || isN64 || isColecoVision || isGenesis ? null : (
        <>
          <div
            className={twMerge(
              'bottom-safe left-safe absolute flex flex-col gap-2 p-2',
              clsx({ hidden: !gamepadVisible }),
            )}
          >
            {labels.l === null && labels.l2 === null ? null : (
              <div className='flex w-full gap-2'>
                {labels.l === null ? null : (
                  <VirtualGamepadButton buttonName='l' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                    {labels.l}
                  </VirtualGamepadButton>
                )}
                {labels.l2 === null ? null : (
                  <VirtualGamepadButton buttonName='l2' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                    {labels.l2}
                  </VirtualGamepadButton>
                )}
              </div>
            )}
            <div className='relative size-42 overflow-hidden rounded-xl ring ring-white/20'>
              <VirtualGamepadButton
                buttonNames={['up', 'left']}
                group='dpad'
                className='absolute top-0 left-0 size-14 rounded-tl-xl ring-1 ring-white/10'
                title='up,left'
              >
                <span className='icon-[mdi--arrow-up-left-thick]' />
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonName='up'
                group='dpad'
                className='absolute top-0 left-14 h-21 w-14 [clip-path:polygon(0_0,100%_0,100%_66.6667%,50%_100%,0_66.6667%)]'
                title='up'
              >
                <span className='pointer-events-none absolute top-0 left-0 flex size-14 items-center justify-center'>
                  <span className='icon-[mdi--arrow-up-thick]' />
                </span>
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonNames={['right', 'up']}
                group='dpad'
                className='absolute top-0 right-0 size-14 rounded-tr-xl ring-1 ring-white/10'
                title='right,up'
              >
                <span className='icon-[mdi--arrow-top-right-thick]' />
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonName='left'
                group='dpad'
                className='absolute top-14 left-0 h-14 w-21 [clip-path:polygon(0_0,66.6667%_0,100%_50%,66.6667%_100%,0_100%)]'
                title='left'
              >
                <span className='pointer-events-none absolute top-0 left-0 flex size-14 items-center justify-center'>
                  <span className='icon-[mdi--arrow-left-thick]' />
                </span>
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonName='right'
                group='dpad'
                className='absolute top-14 right-0 h-14 w-21 [clip-path:polygon(33.3333%_0,100%_0,100%_100%,33.3333%_100%,0_50%)]'
                title='right'
              >
                <span className='pointer-events-none absolute top-0 right-0 flex size-14 items-center justify-center'>
                  <span className='icon-[mdi--arrow-right-thick]' />
                </span>
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonNames={['left', 'down']}
                group='dpad'
                className='absolute bottom-0 left-0 size-14 rounded-bl-xl ring-1 ring-white/10'
                title='left,down'
              >
                <span className='icon-[mdi--arrow-bottom-left-thick]' />
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonName='down'
                group='dpad'
                className='absolute bottom-0 left-14 h-21 w-14 [clip-path:polygon(50%_0,100%_33.3333%,100%_100%,0_100%,0_33.3333%)]'
                title='down'
              >
                <span className='pointer-events-none absolute bottom-0 left-0 flex size-14 items-center justify-center'>
                  <span className='icon-[mdi--arrow-bottom-thick]' />
                </span>
              </VirtualGamepadButton>
              <VirtualGamepadButton
                buttonNames={['right', 'down']}
                group='dpad'
                className='absolute right-0 bottom-0 size-14 rounded-br-xl ring-1 ring-white/10'
                title='right,down'
              >
                <span className='icon-[mdi--arrow-bottom-right-thick]' />
              </VirtualGamepadButton>
            </div>
            {labels.select === null ? null : (
              <VirtualGamepadButton buttonName='select' className='rounded py-1 text-xs ring ring-white/20'>
                {isArcade ? (
                  <>
                    <span className='icon-[mdi--hand-coin]' />
                    {t('emulator.coin')}
                  </>
                ) : (
                  <>
                    {labels.select === 'Select' ? <span className='icon-[mdi--menu]' /> : null}
                    {labels.select}
                  </>
                )}
              </VirtualGamepadButton>
            )}
          </div>

          <div
            className={twMerge(
              'bottom-safe right-safe absolute flex flex-col gap-2 p-2',
              clsx({ hidden: !gamepadVisible }),
            )}
          >
            {labels.r === null && labels.r2 === null ? null : (
              <div className='flex w-full gap-2'>
                {labels.r2 === null ? null : (
                  <VirtualGamepadButton buttonName='r2' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                    {labels.r2}
                  </VirtualGamepadButton>
                )}
                {labels.r === null ? null : (
                  <VirtualGamepadButton buttonName='r' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                    {labels.r}
                  </VirtualGamepadButton>
                )}
              </div>
            )}
            <div className='grid grid-cols-3 grid-rows-3 *:size-14 *:rounded-full'>
              {faceButtons.map(([button, position]) =>
                labels[button] === null ? null : (
                  <VirtualGamepadButton
                    buttonName={button}
                    className={twMerge(position, 'ring ring-white/20', clsx({ 'text-xs': labels[button].length > 2 }))}
                    group='face'
                    key={button}
                  >
                    {labels[button]}
                  </VirtualGamepadButton>
                ),
              )}
            </div>
            <VirtualGamepadButton buttonName='start' className='rounded py-1 text-xs ring ring-white/20'>
              <span className='icon-[mdi--play]' /> {labels.start}
            </VirtualGamepadButton>
          </div>
        </>
      )}
    </div>
  )
}
