import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Virtual Boy's controls, laid out as on its controller: a d-pad for each thumb, the d-pad every console shares,
// with plain Select and Start under the left one and dark grey B and A under the right, and L and R as the short light
// bars from the PlayStation controls above them. In landscape the Virtual Boy's wide picture leaves little room
// beside it, so each side stacks down the edge at about half the size. Beetle VB reads the left d-pad from the
// RetroPad's d-pad and the right one's up, down, left and right from L2, L3, R2 and R3, which have no keys, so the
// right d-pad presses them on the on-screen gamepad.
const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold text-[#e8e8ea] landscape:text-sm')
const bumper = twMerge(
  pressed,
  'absolute bottom-[360px] h-5.5 w-37.5 rounded-md text-[11px] font-extrabold text-[#3a3a40] shadow-[0_2px_3px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[312px] landscape:w-19',
)
const bumperStyle: CSSProperties = { background: 'linear-gradient(#e6e6ea, #b4b4bc)' }
const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
  'landscape:h-6 landscape:px-2.25 landscape:text-[10px]',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }
// The standard gamepad's L2, L3, R2 and R3
const rightDPadButtons = { down: 10, left: 7, right: 11, up: 6 }

export function VbControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are 88 points wide in landscape, where the picture, 384 by 224, leaves about that much beside
  // it; on smaller screens they shrink towards their corner. Each group hangs off a point with no size at its corner,
  // which is where it shrinks towards
  const scale = useControlsScale(88, 384 / 224)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(bumper, 'left-4.5 landscape:left-1.5')}
          style={bumperStyle}
          title='L'
        >
          L
        </VirtualGamepadButton>
        <DPad className='absolute bottom-42 left-3.25 size-40 landscape:bottom-26 landscape:left-1 landscape:size-20' />
        <div className='absolute bottom-23 left-5.5 flex gap-2 landscape:bottom-4.5 landscape:left-1.5 landscape:w-19 landscape:flex-col landscape:items-center landscape:gap-1.5'>
          <VirtualGamepadButton buttonName='select' className={plain} style={plainStyle} title='Select'>
            SELECT
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Start'>
            START
          </VirtualGamepadButton>
        </div>
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(bumper, 'right-4.5 landscape:right-1.5')}
          style={bumperStyle}
          title='R'
        >
          R
        </VirtualGamepadButton>
        <DPad
          className='absolute right-3.25 bottom-42 size-40 landscape:right-1 landscape:bottom-26 landscape:size-20'
          gamepadButtons={rightDPadButtons}
          group='right-dpad'
        />
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            round,
            'right-25 bottom-17.5 size-15.5 landscape:right-11.5 landscape:bottom-8.5 landscape:size-9.5',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        >
          B
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            round,
            'right-6 bottom-22 size-15.5 landscape:right-1 landscape:bottom-13 landscape:size-9.5',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        >
          A
        </VirtualGamepadButton>
      </div>
    </>
  )
}
