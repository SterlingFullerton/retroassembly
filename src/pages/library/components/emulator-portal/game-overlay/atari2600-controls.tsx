import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari 2600's controls drawn like its own: the CX40 joystick, which presses eight directions, its single red fire
// button, and the console's Game Select and Game Reset switches as silver levers named in orange, between the hands in
// portrait or beside pause in landscape. Stella reads the joystick as the d-pad, fire as B, and the two switches as
// Select and Start.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'

function ConsoleSwitch({ buttonName, label }: Readonly<{ buttonName: string; label: string }>) {
  return (
    <VirtualGamepadButton
      buttonName={buttonName}
      className={twMerge(
        pressed,
        'flex flex-col items-center gap-1 bg-transparent px-1 data-[touching=true]:bg-transparent',
      )}
      title={`Game ${label}`}
    >
      <span
        className='block h-7.5 w-5.5 rounded shadow-[0_2px_3px_#0009]'
        style={{ background: 'linear-gradient(90deg, #8a8a90, #e8e8ee 45%, #9a9aa0)' }}
      />
      <span className='text-center text-[8px] leading-tight font-extrabold tracking-[0.12em] text-[#e88a3a]'>
        GAME
        <br />
        {label.toUpperCase()}
      </span>
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

      {/* Game Select and Game Reset: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[262px] left-0 flex -translate-x-1/2 gap-5 landscape:top-3 landscape:bottom-auto landscape:translate-x-0 landscape:gap-3'>
          <ConsoleSwitch buttonName='select' label='Select' />
          <ConsoleSwitch buttonName='start' label='Reset' />
        </div>
      </div>
    </>
  )
}
