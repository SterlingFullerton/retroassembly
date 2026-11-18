import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The PC Engine's controls drawn like its controller: the d-pad every console shares, dark grey buttons II and I with
// their numerals printed beside them in white, and Select and Run in the top bar
// beside pause. II and I are slanted along the arc the thumb makes rolling from one to the other, as on the
// Game Gear's. Beetle PCE Fast reads II from the RetroPad's B, I from A, Select from Select and Run from Start; the
// six-button pad's extra buttons, which only a few games use, are left out.
const white = '#e8e8ea'

const pressed = pressedLook(125)

export function PcEngineControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
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

      {/* II and I, slanted, with their numerals printed below and to the right */}
      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-27 bottom-19 size-19.5 rounded-full landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='II'
        />
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            pressed,
            'absolute right-4.5 bottom-29 size-19.5 rounded-full landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='I'
        />
        <span
          className={twMerge(number, 'right-35 bottom-12.5 landscape:right-27 landscape:bottom-11.5')}
          style={{ color: white }}
        >
          II
        </span>
        <span
          className={twMerge(number, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: white }}
        >
          I
        </span>
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start' title='Run'>
          RUN
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
