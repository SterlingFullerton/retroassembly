import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Neo Geo Pocket's controls: the d-pad every console shares, dark grey A and B slanted along the arc the thumb makes
// rolling from one to the other, as on the WonderSwan and Lynx, and a plain Option button between the hands in
// portrait, or beside pause in landscape. Beetle Neo Geo Pocket reads A from the RetroPad's B, B from A, and Option from
// Start. Neo Geo Pocket Color games share them.
const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full text-2xl font-extrabold text-[#e8e8ea] landscape:text-xl')

export function NgpControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Pocket's
  // picture is almost square, so in landscape it leaves more room beside it. Each group hangs off a point with no size
  // at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 160 / 152)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            round,
            'right-27 bottom-19 size-19.5 landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        >
          A
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            round,
            'right-4.5 bottom-29 size-19.5 landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        >
          B
        </VirtualGamepadButton>
      </div>

      {/* Option: between the hands in portrait, beside pause in landscape */}
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
            title='Option'
          >
            OPTION
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
