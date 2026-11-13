import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Master System's controls drawn like its controller: the d-pad every console shares, dark grey buttons 1 and 2
// with their numbers printed beside them in white, and a plain Pause button, for the console's own, between the hands in
// portrait, or beside pause in landscape. 1 and 2 are slanted along the arc the thumb makes rolling from one to the
// other, as on the Game Gear's. Genesis Plus GX, PicoDrive and Gearsystem all read button 1 from the RetroPad's B, 2
// from A, and Pause from Start.
const white = '#e8e8ea'

const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'

export function MasterSystemControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
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
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </div>

      {/* 1 and 2, slanted, with their numbers printed below and to the right */}
      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
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
          style={{ color: white }}
        >
          1
        </span>
        <span
          className={twMerge(number, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: white }}
        >
          2
        </span>
      </div>

      {/* Pause: between the hands in portrait, beside the app's pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 -translate-x-1/2 landscape:top-1 landscape:bottom-auto landscape:translate-x-0'>
          <VirtualGamepadButton
            buttonName='start'
            className={twMerge(
              pressed,
              'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
            )}
            style={{ background: 'linear-gradient(#3a3a3d, #202022)' }}
            title='Pause'
          >
            PAUSE
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
