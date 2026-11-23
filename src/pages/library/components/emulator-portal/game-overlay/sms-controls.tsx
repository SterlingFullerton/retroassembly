import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook, SlantedPair } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'

// Sega's 8-bit consoles, the Master System and the Game Gear, drawn like their own buttons: the d-pad every console
// shares, and dark grey buttons 1 and 2 slanted along the arc the thumb makes rolling from one to the other, with their
// numbers on them. The Master System's are in white, and its console's own Pause sits in the top
// bar beside the app's; the Game Gear's are in its blue, with Start in the top bar. Genesis Plus GX, PicoDrive and
// Gearsystem all read button 1 from the RetroPad's B, 2 from A, and Pause or Start from Start. SG-1000 games, whose
// controller is the Master System's, share its controls.
const consoles = {
  gamegear: { label: 'START', numbers: '#4a90e0', picture: 10 / 9, title: undefined },
  mastersystem: { label: 'PAUSE', numbers: '#e8e8ea', picture: 4 / 3, title: 'Pause' },
}

const pressed = pressedLook(125)

const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006, 0 0 0 2px #3a3a42',
}

function SegaEightBitControls({ kind, visible }: Readonly<{ kind: keyof typeof consoles; visible: boolean }>) {
  const { label, numbers, picture, title } = consoles[kind]
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Game
  // Gear's picture is almost square (10:9), so in landscape it leaves more room beside it
  const scale = useControlsScale(picture)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* 1 and 2, slanted */}
      <Corner scale={scale} side='right' visible={visible}>
        <SlantedPair
          buttons={[
            { buttonName: 'b', label: '1' },
            { buttonName: 'a', label: '2' },
          ]}
          className={twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold landscape:text-xl')}
          labelColor={numbers}
          style={buttonStyle}
        />
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start' title={title}>
          {label}
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}

export function MasterSystemControls({ visible }: Readonly<{ visible: boolean }>) {
  return <SegaEightBitControls kind='mastersystem' visible={visible} />
}

export function GameGearControls({ visible }: Readonly<{ visible: boolean }>) {
  return <SegaEightBitControls kind='gamegear' visible={visible} />
}
