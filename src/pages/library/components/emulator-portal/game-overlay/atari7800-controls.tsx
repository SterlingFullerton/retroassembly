import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari 7800's controls, like the 2600's: the joystick, which presses eight directions, its two red buttons, 1 and
// 2, slanted along the arc the thumb makes rolling from one to the other, and the console's Select, Pause and Reset as
// plain buttons between the hands in portrait, or stacked under pause in landscape. ProSystem reads the joystick as the
// d-pad, 1 as B, 2 as A, and Select, Pause and Reset as Select, Start and X.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'
const fireStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #ff6a5a, #d0281c 60%, #8a140c)',
  boxShadow: '0 3px 5px #000c, inset 0 -3px 0 #0004, inset 0 2px 0 #ff9a90',
}
const fire = twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold text-[#3a0000]')
const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

export function Atari7800Controls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <div className='absolute bottom-16 left-5 size-37.5 landscape:bottom-15 landscape:left-3 landscape:size-34'>
          <Joystick />
        </div>
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            fire,
            'right-27 bottom-19 size-19.5 landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='fire'
          style={fireStyle}
          title='1'
        >
          1
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            fire,
            'right-4.5 bottom-29 size-19.5 landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='fire'
          style={fireStyle}
          title='2'
        >
          2
        </VirtualGamepadButton>
      </div>

      {/* Select, Pause and Reset: side by side between the hands in portrait, stacked under pause in landscape, where
          side by side they would reach the game */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 flex -translate-x-1/2 gap-2 landscape:top-[52px] landscape:bottom-auto landscape:left-3 landscape:translate-x-0 landscape:flex-col landscape:items-start'>
          <VirtualGamepadButton buttonName='select' className={plain} style={plainStyle} title='Select'>
            SELECT
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Pause'>
            PAUSE
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='x' className={plain} style={plainStyle} title='Reset'>
            RESET
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
