import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Joystick } from './joystick.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari 2600's controls drawn like its own: the CX40 joystick, which presses eight directions, its single red fire
// button, and the console's Select and Reset switches in the top bar beside pause. Stella reads the joystick as the d-pad, fire as B, and the two switches as Select and Start.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'

export function Atari2600Controls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  const fireStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #ff6a5a, #d0281c 60%, #8a140c)',
    boxShadow: '0 3px 5px #000c, inset 0 -3px 0 #0004, inset 0 2px 0 #ff9a90',
  }

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
            pressed,
            'absolute right-11 bottom-23 size-24 rounded-full text-[13px] font-extrabold tracking-[0.08em] text-[#3a0000] landscape:right-9 landscape:bottom-21.5 landscape:size-20.5',
          )}
          group='fire'
          style={fireStyle}
          title='Fire'
        >
          FIRE
        </VirtualGamepadButton>
      </div>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start' title='Reset'>
          RESET
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
