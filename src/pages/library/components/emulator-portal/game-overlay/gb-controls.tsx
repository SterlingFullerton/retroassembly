import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Game Boy's controls drawn like its own buttons: the d-pad every console shares, berry-coloured B and A with their letters
// printed beside them, and Select and Start in the top bar beside pause.
// B and A are slanted along the arc the thumb makes rolling from one to the other, as on the NES's. Game Boy Color
// games share them. Every Game Boy emulator reads the RetroPad's B, A, Select and Start as the Game Boy's.
const berry = '#d0508a'

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
  const letter = 'absolute font-black text-lg landscape:text-base'

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* B and A, slanted, with their letters printed below and to the right as on the Game Boy */}
      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-27 bottom-19 size-19.5 rounded-full landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        />
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            pressed,
            'absolute right-4.5 bottom-29 size-19.5 rounded-full landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        />
        <span
          className={twMerge(letter, 'right-35 bottom-12.5 landscape:right-27 landscape:bottom-11.5')}
          style={{ color: berry }}
        >
          B
        </span>
        <span
          className={twMerge(letter, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: berry }}
        >
          A
        </span>
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
