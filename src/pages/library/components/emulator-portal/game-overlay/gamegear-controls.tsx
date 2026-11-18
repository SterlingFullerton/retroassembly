import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Game Gear's controls drawn like its own buttons: the d-pad every console shares, dark grey buttons 1 and 2 with
// their numbers printed beside them in the Game Gear's blue, and Start in the top bar beside pause. 1 and 2 are slanted along the arc the thumb makes rolling from one to the other, as on the
// NES's. Genesis Plus GX and Gearsystem both read button 1 from the RetroPad's B, 2 from A, and Start from Start.
const blue = '#4a90e0'

const pressed = pressedLook(125)

export function GameGearControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Game Gear's
  // picture is almost square (10:9), so in landscape it leaves more room beside it. Each group hangs off a point with
  // no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 10 / 9)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006, 0 0 0 2px #3a3a42',
  }
  const number = 'absolute font-black text-lg landscape:text-base'

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* 1 and 2, slanted, with their numbers printed below and to the right */}
      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-27 bottom-19 size-19.5 rounded-full landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='1'
        />
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            pressed,
            'absolute right-4.5 bottom-29 size-19.5 rounded-full landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='2'
        />
        <span
          className={twMerge(number, 'right-35 bottom-12.5 landscape:right-27 landscape:bottom-11.5')}
          style={{ color: blue }}
        >
          1
        </span>
        <span
          className={twMerge(number, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: blue }}
        >
          2
        </span>
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
