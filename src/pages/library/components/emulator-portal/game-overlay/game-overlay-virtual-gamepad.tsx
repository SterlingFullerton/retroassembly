import { clsx } from 'clsx'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { twMerge } from 'tailwind-merge'
import { resolveConsole } from '#@/consoles/registry.ts'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useTouchControls } from '#@/pages/library/hooks/use-touch-controls.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'
import { ArcadeControls } from './arcade-controls.tsx'
import { Atari2600Controls } from './atari2600-controls.tsx'
import { Atari5200Controls } from './atari5200-controls.tsx'
import { Atari7800Controls } from './atari7800-controls.tsx'
import { ChannelFControls } from './channelf-controls.tsx'
import { ColecoVisionControls } from './colecovision-controls.tsx'
import { DPad } from './dpad.tsx'
import { GameGearControls } from './gamegear-controls.tsx'
import { GbControls } from './gb-controls.tsx'
import { GbaControls } from './gba-controls.tsx'
import { GenesisControls } from './genesis-controls.tsx'
import { GwControls } from './gw-controls.tsx'
import { LynxControls } from './lynx-controls.tsx'
import { N64Controls } from './n64-controls.tsx'
import { NesControls } from './nes-controls.tsx'
import { NgpControls } from './ngp-controls.tsx'
import { Odyssey2Controls } from './odyssey2-controls.tsx'
import { PcEngineControls } from './pce-controls.tsx'
import { PspControls } from './psp-controls.tsx'
import { PsxControls } from './psx-controls.tsx'
import { MasterSystemControls } from './sms-controls.tsx'
import { SnesControls } from './snes-controls.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VbControls } from './vb-controls.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'
import { WonderSwanControls } from './wonderswan-controls.tsx'

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
  const { emulator } = useSession()
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
  const { emulator } = useSession()

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

// On DS in portrait the controls fill one strip under the game: L and R in its top corners, and the d-pad and the face
// buttons on either side. In landscape the game takes the whole height and the controls go to its sides, as on the N64:
// L and R up top, the d-pad low on the left, the face buttons low on the right. Select and Start are in the top bar
// beside pause. Flat, translucent buttons turn white while pressed. Mic, for games you blow into or shout at, sits at
// the bottom between the d-pad and the face buttons in portrait, and after Start in landscape: DeSmuME can't hear a real microphone, so while it's held the game hears the sound of blowing instead.
const dsButton = 'bg-white/9 text-white/80 data-[touching=true]:bg-white/85 data-[touching=true]:text-black'

export function DSControls({
  controls,
  visible,
}: Readonly<{
  controls: RefObject<HTMLDivElement | null>
  visible: boolean
}>) {
  return (
    <>
      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
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

        <VirtualGamepadButton
          buttonName='l3'
          className={twMerge(
            dsButton,
            'absolute bottom-3 left-1/2 h-8 w-15 -translate-x-1/2 rounded-full text-[11px] font-bold tracking-wider max-[359px]:portrait:w-8',
            'landscape:left-safe-offset-39 landscape:top-1 landscape:bottom-auto landscape:h-6 landscape:translate-x-0',
          )}
          title='Mic'
        >
          <span className='icon-[mdi--microphone] size-3.5' />
          {/* Phones narrower than 360 points leave room only for the icon between the d-pad and the face buttons */}
          <span className='max-[359px]:portrait:hidden'>MIC</span>
        </VirtualGamepadButton>

        {/* The d-pad */}
        <DPad
          className={twMerge(
            'absolute top-10.5 left-2.5 size-33',
            'landscape:left-safe-offset-4 landscape:top-auto landscape:bottom-14',
          )}
        />

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
    </>
  )
}

// X, Y, A and B around a diamond, by their grid cells
const faceButtons: [RetroPadButton & ('a' | 'b' | 'x' | 'y'), string][] = [
  ['x', 'col-start-2 row-start-1'],
  ['y', 'col-start-1 row-start-2'],
  ['a', 'col-start-3 row-start-2'],
  ['b', 'col-start-2 row-start-3'],
]

export function GameOverlayVirtualGamepad() {
  const { connected } = useGamepads()
  const [gamepadVisible, setGamepadVisible] = useState(!connected)
  const { show } = useGameOverlay()
  const touchControls = useTouchControls()
  const [launched] = useEmulatorLaunched()
  const rom = useRom()
  const { preference } = usePreference()
  const rewindEnabled = rom ? preference.emulator.platform[rom.platform].rewindEnabled : true
  const { t } = useTranslation()
  const { core } = useSession()
  // Which controls this game gets, and whether Select inserts a coin, are set per console and emulator in the console
  // registry (src/consoles)
  const { coin: isArcade, controls } = rom ? resolveConsole(rom.platform, core) : { coin: false, controls: 'generic' }
  const [keypadOpen, setKeypadOpen] = useState(false)
  const closeKeypad = useCallback(() => setKeypadOpen(false), [])
  const dsControls = useRef<HTMLDivElement>(null)
  useFitGameAboveControls(launched && controls === 'ds', dsControls)
  // Rotated for a game played upright, the WonderSwan's picture is tall; in portrait it's kept above the controls
  const wonderSwanControlsTop = useRef<HTMLDivElement>(null)
  useFitGameAboveControls(launched && controls === 'wonderswan', wonderSwanControlsTop)
  // So is the Lynx's, rotated for a game played with it held upright
  const lynxControlsTop = useRef<HTMLDivElement>(null)
  useFitGameAboveControls(launched && controls === 'lynx', lynxControlsTop)

  if (!launched) {
    return
  }

  return (
    <div
      className={twMerge(
        'fixed inset-0 block touch-none',
        // Shown by how the game is played, not the screen's size (see useTouchControls)
        clsx({ hidden: !touchControls }),
        // The DS bottom screen is a touchscreen, so touches outside the buttons must reach the game
        clsx({ 'pointer-events-none! *:pointer-events-auto': controls === 'ds' }),
      )}
    >
      <div className='top-safe p-x-2 absolute inset-x-0 flex'>
        <VirtualGamepadButton
          className={twMerge('left-safe absolute rounded p-2', clsx({ hidden: !gamepadVisible }))}
          onClick={async () => await show()}
        >
          <span className='icon-[mdi--pause]' />
        </VirtualGamepadButton>
        {/* The ColecoVision's and Atari 5200's keypads open from beside pause */}
        {controls === 'colecovision' || controls === 'atari5200' ? (
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

      {controls === 'ds' ? <DSControls controls={dsControls} visible={gamepadVisible} /> : null}
      {controls === 'n64' ? <N64Controls visible={gamepadVisible} /> : null}
      {controls === 'colecovision' ? (
        <ColecoVisionControls keypadOpen={keypadOpen} onKeypadClose={closeKeypad} visible={gamepadVisible} />
      ) : null}
      {controls === 'genesis' ? <GenesisControls visible={gamepadVisible} /> : null}
      {controls === 'arcade' ? <ArcadeControls visible={gamepadVisible} /> : null}
      {controls === 'snes' ? <SnesControls visible={gamepadVisible} /> : null}
      {controls === 'nes' ? <NesControls visible={gamepadVisible} /> : null}
      {controls === 'fds' ? <NesControls diskCore={core} visible={gamepadVisible} /> : null}
      {controls === 'gba' ? <GbaControls visible={gamepadVisible} /> : null}
      {controls === 'gb' ? <GbControls visible={gamepadVisible} /> : null}
      {controls === 'atari2600' ? <Atari2600Controls visible={gamepadVisible} /> : null}
      {controls === 'gamegear' ? <GameGearControls visible={gamepadVisible} /> : null}
      {controls === 'mastersystem' ? <MasterSystemControls visible={gamepadVisible} /> : null}
      {controls === 'psx' ? <PsxControls visible={gamepadVisible} /> : null}
      {controls === 'psp' ? <PspControls visible={gamepadVisible} /> : null}
      {controls === 'pcengine' ? <PcEngineControls visible={gamepadVisible} /> : null}
      {controls === 'atari7800' ? <Atari7800Controls visible={gamepadVisible} /> : null}
      {controls === 'ngp' ? <NgpControls visible={gamepadVisible} /> : null}
      {controls === 'channelf' ? <ChannelFControls visible={gamepadVisible} /> : null}
      {controls === 'vb' ? <VbControls visible={gamepadVisible} /> : null}
      {controls === 'gw' ? <GwControls visible={gamepadVisible} /> : null}
      {controls === 'odyssey2' ? <Odyssey2Controls visible={gamepadVisible} /> : null}
      {controls === 'lynx' ? <LynxControls top={lynxControlsTop} visible={gamepadVisible} /> : null}
      {controls === 'atari5200' ? (
        <Atari5200Controls keypadOpen={keypadOpen} onKeypadClose={closeKeypad} visible={gamepadVisible} />
      ) : null}
      {controls === 'wonderswan' ? <WonderSwanControls top={wonderSwanControlsTop} visible={gamepadVisible} /> : null}
      {controls === 'generic' ? (
        <>
          <TopBarButtons visible={gamepadVisible}>
            <TopBarButton buttonName='select' className={clsx({ uppercase: isArcade })}>
              {isArcade ? t('emulator.coin') : 'SELECT'}
            </TopBarButton>
            <TopBarButton buttonName='start'>START</TopBarButton>
          </TopBarButtons>
          <div
            className={twMerge(
              'bottom-safe left-safe absolute flex flex-col gap-2 p-2',
              clsx({ hidden: !gamepadVisible }),
            )}
          >
            <div className='flex w-full gap-2'>
              <VirtualGamepadButton buttonName='l' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                L1
              </VirtualGamepadButton>
              <VirtualGamepadButton buttonName='l2' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                L2
              </VirtualGamepadButton>
            </div>
            <DPad className='size-42' />
          </div>

          <div
            className={twMerge(
              'bottom-safe right-safe absolute flex flex-col gap-2 p-2',
              clsx({ hidden: !gamepadVisible }),
            )}
          >
            <div className='flex w-full gap-2'>
              <VirtualGamepadButton buttonName='r2' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                R2
              </VirtualGamepadButton>
              <VirtualGamepadButton buttonName='r' className='flex-1 rounded px-2 py-1 ring ring-white/20'>
                R1
              </VirtualGamepadButton>
            </div>
            <div className='grid grid-cols-3 grid-rows-3 *:size-14 *:rounded-full'>
              {faceButtons.map(([button, position]) => (
                <VirtualGamepadButton
                  buttonName={button}
                  className={twMerge(position, 'ring ring-white/20')}
                  group='face'
                  key={button}
                >
                  {button.toUpperCase()}
                </VirtualGamepadButton>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
