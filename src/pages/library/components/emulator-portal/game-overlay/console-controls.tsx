import { type ReactNode, type RefObject, useRef } from 'react'
import { ArcadeControls } from './arcade-controls.tsx'
import { Atari2600Controls } from './atari2600-controls.tsx'
import { Atari5200Controls } from './atari5200-controls.tsx'
import { Atari7800Controls } from './atari7800-controls.tsx'
import { ChannelFControls } from './channelf-controls.tsx'
import { ColecoVisionControls } from './colecovision-controls.tsx'
import { DSControls } from './game-overlay-virtual-gamepad.tsx'
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
import { GameGearControls, MasterSystemControls } from './sms-controls.tsx'
import { SnesControls } from './snes-controls.tsx'
import { VbControls } from './vb-controls.tsx'
import { WonderSwanControls } from './wonderswan-controls.tsx'

interface ConsoleControlsProps {
  /** Which console's controls: the name its setup gives them */
  kind: string
  /** Whether the ColecoVision's or Atari 5200's keypad is open, and what closes it */
  keypadOpen?: boolean
  onKeypadClose?: () => void
  /** Given the top of the controls where a game is kept above them in portrait: the DS's, Lynx's and WonderSwan's */
  top?: RefObject<HTMLDivElement | null>
}

function ignore() {
  // No keypad to close
}

/**
 * One console's on-screen controls, by name, wherever a session is: a game being played, or a stand-in for one. Nothing
 * for a name no console has
 */
export function ConsoleControls({
  keypadOpen = false,
  kind,
  onKeypadClose = ignore,
  top: given,
}: Readonly<ConsoleControlsProps>) {
  const own: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null)
  const top = given ?? own
  const keypad = { keypadOpen, onKeypadClose }
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
  return all[kind] ?? null
}

/** Whether a console's controls go by this name */
export function hasConsoleControls(kind: string) {
  return consoleControlKinds.has(kind)
}

const consoleControlKinds = new Set([
  'arcade',
  'atari2600',
  'atari5200',
  'atari7800',
  'channelf',
  'colecovision',
  'ds',
  'fds',
  'gamegear',
  'gb',
  'gba',
  'genesis',
  'gw',
  'lynx',
  'mastersystem',
  'n64',
  'nes',
  'ngp',
  'odyssey2',
  'pcengine',
  'psp',
  'psx',
  'snes',
  'vb',
  'wonderswan',
])
