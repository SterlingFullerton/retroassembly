import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Virtual Boy's controls, laid out as on its controller: a d-pad for each thumb, the d-pad every console shares,
// with dark grey B and A under the right one, and L and R as the short light
// bars from the PlayStation controls above them. Select and Start are in the top bar beside pause. In landscape the Virtual Boy's wide picture leaves little room
// beside it, so each side stacks down the edge at about half the size. Beetle VB reads the left d-pad from the
// RetroPad's d-pad and the right one's up, down, left and right from L2, L3, R2 and R3, which have no keys, so the
// right d-pad presses them on the on-screen gamepad.
const pressed = pressedLook(125)
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold text-[#e8e8ea] landscape:text-lg')
const bumper = twMerge(
  pressed,
  'touch-tall absolute bottom-[360px] h-5.5 w-37.5 rounded-md text-[11px] font-extrabold text-[#3a3a40] shadow-[0_2px_3px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[312px] landscape:w-33',
)
const bumperStyle: CSSProperties = { background: 'linear-gradient(#e6e6ea, #b4b4bc)' }
// The standard gamepad's L2, L3, R2 and R3
const rightDPadButtons = { down: 10, left: 7, right: 11, up: 6 }

export function VbControls({ visible }: Readonly<{ visible: boolean }>) {
  // In landscape the picture, 384 by 224, leaves little room beside it, so the controls sit over its edges; on smaller
  // screens they shrink towards their corner. Each group hangs off a point with no size at its corner,
  // which is where it shrinks towards
  const scale = useControlsScale(384 / 224)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(bumper, 'left-4.5 landscape:left-2')}
          style={bumperStyle}
          title='L'
        >
          L
        </VirtualGamepadButton>
        <DPad className='absolute bottom-42 left-3.25 size-40 landscape:bottom-24 landscape:left-2 landscape:size-33' />
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(bumper, 'right-4.5 landscape:right-2')}
          style={bumperStyle}
          title='R'
        >
          R
        </VirtualGamepadButton>
        <DPad
          className='absolute right-3.25 bottom-42 size-40 landscape:right-2 landscape:bottom-24 landscape:size-33'
          gamepadButtons={rightDPadButtons}
          group='right-dpad'
        />
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            round,
            'right-25 bottom-17.5 size-15.5 landscape:right-16 landscape:bottom-3 landscape:size-12',
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
            'right-6 bottom-22 size-15.5 landscape:right-2 landscape:bottom-8.5 landscape:size-12',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        >
          A
        </VirtualGamepadButton>
      </Corner>
      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
