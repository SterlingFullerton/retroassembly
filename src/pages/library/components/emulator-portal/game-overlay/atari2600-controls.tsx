import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari 2600's controls drawn like its own: the CX40 joystick, which presses eight directions, its single red fire
// button, and the console's Select and Reset switches as plain buttons, between the hands in portrait or beside pause in
// landscape. Stella reads the joystick as the d-pad, fire as B, and the two switches as Select and Start.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'

function ConsoleSwitch({ buttonName, label }: Readonly<{ buttonName: string; label: string }>) {
  return (
    <VirtualGamepadButton
      buttonName={buttonName}
      className={twMerge(
        pressed,
        'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
      )}
      style={{ background: 'linear-gradient(#3a3a3d, #202022)' }}
      title={label}
    >
      {label.toUpperCase()}
    </VirtualGamepadButton>
  )
}

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

      {/* Select and Reset: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 flex -translate-x-1/2 gap-2 landscape:top-1 landscape:bottom-auto landscape:translate-x-0'>
          <ConsoleSwitch buttonName='select' label='Select' />
          <ConsoleSwitch buttonName='start' label='Reset' />
        </div>
      </div>
    </>
  )
}
