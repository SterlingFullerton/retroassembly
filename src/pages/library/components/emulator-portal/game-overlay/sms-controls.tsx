import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook, SlantedPair } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'

// The Master System's controls drawn like its controller: the d-pad every console shares, dark grey buttons 1 and 2
// with their numbers printed beside them in white, and the console's own Pause in the top bar beside
// the app's. 1 and 2 are slanted along the arc the thumb makes rolling from one to the
// other, as on the Game Gear's. Genesis Plus GX, PicoDrive and Gearsystem all read button 1 from the RetroPad's B, 2
// from A, and Pause from Start. SG-1000 games, whose controller is the same, share them.
const white = '#e8e8ea'

const pressed = pressedLook(125)

export function MasterSystemControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006, 0 0 0 2px #3a3a42',
  }

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* 1 and 2, slanted, with their numbers printed below and to the right */}
      <Corner scale={scale} side='right' visible={visible}>
        <SlantedPair
          buttons={[
            { buttonName: 'b', label: '1' },
            { buttonName: 'a', label: '2' },
          ]}
          className={twMerge(pressed, 'absolute rounded-full')}
          printed={white}
          style={buttonStyle}
        />
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start' title='Pause'>
          PAUSE
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
