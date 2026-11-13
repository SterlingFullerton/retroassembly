import { clsx } from 'clsx'
import type { CSSProperties, RefObject } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { refitGame } from './refit-game.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari Lynx's controls, in the WonderSwan's style: the d-pad every console shares, dark grey B and A slanted along
// the arc the thumb makes rolling from one to the other, and plain Option 1, Option 2, Pause and Rotate, in two rows
// between the hands in portrait or stacked under pause in landscape. Rotate turns the picture for games played with the
// Lynx held upright, and the d-pad with it. Beetle Lynx reads A from the RetroPad's B, B from A, Option 1 and 2 from L
// and R, Pause from Start and Rotate from Select.
const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full font-extrabold text-[#e8e8ea]')
const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

export function LynxControls({ top, visible }: Readonly<{ top: RefObject<HTMLDivElement | null>; visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 120 points wide in landscape; the Lynx's picture is wide (about 16:10), which leaves
  // little room beside it. On smaller screens they shrink towards their corner. Each group hangs off a point with no
  // size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 160 / 102)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-14 landscape:left-2.5 landscape:size-26.5' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            round,
            'right-27 bottom-19 size-19.5 text-2xl landscape:right-15 landscape:bottom-15.5 landscape:size-12 landscape:text-lg',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        >
          B
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            round,
            'right-4.5 bottom-29 size-19.5 text-2xl landscape:right-2 landscape:bottom-22.5 landscape:size-12 landscape:text-lg',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        >
          A
        </VirtualGamepadButton>
      </div>

      {/* Option 1, Option 2, Pause and Rotate: two rows between the hands in portrait, stacked under pause in
          landscape, where side by side they would reach the game */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        {/* Marks the top of the controls, so that in portrait the game, upright or not, fits above them */}
        <div className='absolute bottom-[334px] left-0 h-px w-px landscape:hidden' ref={top} />
        <div className='absolute bottom-[262px] left-0 grid w-max -translate-x-1/2 grid-cols-2 gap-2 landscape:top-[52px] landscape:bottom-auto landscape:left-2.5 landscape:flex landscape:translate-x-0 landscape:flex-col landscape:items-start'>
          <VirtualGamepadButton buttonName='l' className={plain} style={plainStyle} title='Option 1'>
            OPTION 1
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='r' className={plain} style={plainStyle} title='Option 2'>
            OPTION 2
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Pause'>
            PAUSE
          </VirtualGamepadButton>
          <VirtualGamepadButton
            buttonName='select'
            className={plain}
            onVirtualPressEnd={refitGame}
            style={plainStyle}
            title='Rotate'
          >
            ROTATE
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
