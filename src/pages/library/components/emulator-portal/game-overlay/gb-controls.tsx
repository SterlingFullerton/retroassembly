import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook, SlantedPair } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'

// The Game Boy's controls drawn like its own buttons: the d-pad every console shares, berry-coloured B and A with
// their letters on them in white, and Select and Start in the top bar beside pause.
// B and A are slanted along the arc the thumb makes rolling from one to the other, as on the NES's. Game Boy Color
// games share them. Every Game Boy emulator reads the RetroPad's B, A, Select and Start as the Game Boy's.
const pressed = pressedLook(90)

export function GbControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Game Boy's
  // picture is almost square (10:9), so in landscape it leaves more room beside it. Each group hangs off a point with
  // no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 10 / 9)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #e05a95, #a3205e 60%, #6a1038)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #f090bb, inset 0 -3px 0 #0004',
  }

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* B and A, slanted */}
      <Corner scale={scale} side='right' visible={visible}>
        <SlantedPair
          buttons={[
            { buttonName: 'b', label: 'B' },
            { buttonName: 'a', label: 'A' },
          ]}
          className={twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold landscape:text-xl')}
          labelColor='#ffffff'
          style={buttonStyle}
        />
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
