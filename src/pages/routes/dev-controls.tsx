import { type ReactNode, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { connectTestOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { TestSessionProvider } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { ArcadeControls } from '#@/pages/library/components/emulator-portal/game-overlay/arcade-controls.tsx'
import { Atari2600Controls } from '#@/pages/library/components/emulator-portal/game-overlay/atari2600-controls.tsx'
import { Atari5200Controls } from '#@/pages/library/components/emulator-portal/game-overlay/atari5200-controls.tsx'
import { Atari7800Controls } from '#@/pages/library/components/emulator-portal/game-overlay/atari7800-controls.tsx'
import { ChannelFControls } from '#@/pages/library/components/emulator-portal/game-overlay/channelf-controls.tsx'
import { ColecoVisionControls } from '#@/pages/library/components/emulator-portal/game-overlay/colecovision-controls.tsx'
import { DSControls } from '#@/pages/library/components/emulator-portal/game-overlay/game-overlay-virtual-gamepad.tsx'
import { GbControls } from '#@/pages/library/components/emulator-portal/game-overlay/gb-controls.tsx'
import { GbaControls } from '#@/pages/library/components/emulator-portal/game-overlay/gba-controls.tsx'
import { GenesisControls } from '#@/pages/library/components/emulator-portal/game-overlay/genesis-controls.tsx'
import { GwControls } from '#@/pages/library/components/emulator-portal/game-overlay/gw-controls.tsx'
import { LynxControls } from '#@/pages/library/components/emulator-portal/game-overlay/lynx-controls.tsx'
import { N64Controls } from '#@/pages/library/components/emulator-portal/game-overlay/n64-controls.tsx'
import { NesControls } from '#@/pages/library/components/emulator-portal/game-overlay/nes-controls.tsx'
import { NgpControls } from '#@/pages/library/components/emulator-portal/game-overlay/ngp-controls.tsx'
import { Odyssey2Controls } from '#@/pages/library/components/emulator-portal/game-overlay/odyssey2-controls.tsx'
import { PcEngineControls } from '#@/pages/library/components/emulator-portal/game-overlay/pce-controls.tsx'
import { PspControls } from '#@/pages/library/components/emulator-portal/game-overlay/psp-controls.tsx'
import { PsxControls } from '#@/pages/library/components/emulator-portal/game-overlay/psx-controls.tsx'
import {
  GameGearControls,
  MasterSystemControls,
} from '#@/pages/library/components/emulator-portal/game-overlay/sms-controls.tsx'
import { SnesControls } from '#@/pages/library/components/emulator-portal/game-overlay/snes-controls.tsx'
import { VbControls } from '#@/pages/library/components/emulator-portal/game-overlay/vb-controls.tsx'
import { WonderSwanControls } from '#@/pages/library/components/emulator-portal/game-overlay/wonderswan-controls.tsx'

// What the controls sent, for a test to read: the emulator's buttons pressed and let go, and the on-screen gamepad
declare global {
  var testControls: { gamepad: ReturnType<typeof connectTestOnScreenGamepad>; presses: string[] } | undefined
}

function Controls({ kind }: Readonly<{ kind: string }>) {
  const top = useRef<HTMLDivElement>(null)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const keypad = { keypadOpen, onKeypadClose: () => setKeypadOpen(false) }
  const all: Record<string, ReactNode> = {
    arcade: <ArcadeControls visible />,
    atari2600: <Atari2600Controls visible />,
    atari5200: <Atari5200Controls {...keypad} visible />,
    atari7800: <Atari7800Controls visible />,
    channelf: <ChannelFControls visible />,
    colecovision: <ColecoVisionControls {...keypad} visible />,
    ds: <DSControls controls={top} visible />,
    fds: <NesControls diskCore='fceumm' visible />,
    gamegear: <GameGearControls visible />,
    gb: <GbControls visible />,
    gba: <GbaControls visible />,
    genesis: <GenesisControls visible />,
    gw: <GwControls visible />,
    lynx: <LynxControls top={top} visible />,
    mastersystem: <MasterSystemControls visible />,
    n64: <N64Controls visible />,
    nes: <NesControls visible />,
    ngp: <NgpControls visible />,
    odyssey2: <Odyssey2Controls visible />,
    pcengine: <PcEngineControls visible />,
    psp: <PspControls visible />,
    psx: <PsxControls visible />,
    snes: <SnesControls visible />,
    vb: <VbControls visible />,
    wonderswan: <WonderSwanControls top={top} visible />,
  }
  return (
    <>
      {all[kind] ?? <p className='p-4 text-white'>No controls called {kind}</p>}
      {/* Opens the ColecoVision's and Atari 5200's keypads, as the button beside pause does */}
      <button
        aria-label='Open keypad'
        className='hidden'
        data-testid='open-keypad'
        onClick={() => setKeypadOpen(true)}
        type='button'
      />
    </>
  )
}

export default function DevControlsRoute() {
  const { kind = '' } = useParams()
  const [emulator] = useState(() => {
    // Development runs this twice, so both runs record into the same list
    globalThis.testControls ??= { gamepad: connectTestOnScreenGamepad(), presses: [] }
    const { presses } = globalThis.testControls
    return {
      getStatus: () => 'running',
      pressDown: (button: string) => presses.push(`down ${button}`),
      pressUp: (button: string) => presses.push(`up ${button}`),
    }
  })

  return (
    <TestSessionProvider emulator={emulator}>
      <div className='fixed inset-0 block touch-none bg-black'>
        <Controls kind={kind} />
      </div>
    </TestSessionProvider>
  )
}
