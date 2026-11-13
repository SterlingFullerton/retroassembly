import { clsx } from 'clsx'
import type { CSSProperties, RefObject } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { refitGame } from './refit-game.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The WonderSwan's controls: the d-pad every console shares as the X pad, the Y pad as four buttons in a diamond above
// it, dark grey B and A slanted along the arc the thumb makes rolling from one to the other, and plain Start and Rotate.
// Rotate turns the picture for games played upright, and Beetle WonderSwan turns the X pad with it, so the d-pad still
// steers. It reads the X pad from the d-pad, Y1 to Y4 (up, right, down, left) from R2, R, L2 and L, A and B from A and
// B, and Start and Rotate from Start and Select. WonderSwan Color games share them.
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

// The Y pad: each button's RetroPad button and its place in portrait and in landscape
const yButtons: [label: string, buttonName: string, className: string][] = [
  ['Y1', 'r2', 'left-[75px] bottom-[335px] landscape:left-[45px] landscape:bottom-[240px]'],
  ['Y2', 'r', 'left-[121px] bottom-[289px] landscape:left-[81px] landscape:bottom-[204px]'],
  ['Y3', 'l2', 'left-[75px] bottom-[243px] landscape:left-[45px] landscape:bottom-[168px]'],
  ['Y4', 'l', 'left-[29px] bottom-[289px] landscape:left-[9px] landscape:bottom-[204px]'],
]

export function WonderSwanControls({
  top,
  visible,
}: Readonly<{ top: RefObject<HTMLDivElement | null>; visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 120 points wide in landscape; the WonderSwan's picture is wide (14:9), which leaves
  // little room beside it. On smaller screens they shrink towards their corner. Each group hangs off a point with no
  // size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 14 / 9)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        {/* Marks the top of the controls, the Y pad's, so that in portrait the game, upright or not, fits above them */}
        <div className='absolute bottom-[388px] left-0 h-px w-px' ref={top} />
        {yButtons.map(([label, buttonName, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(round, 'size-11.5 text-base landscape:size-9 landscape:text-[13px]', className)}
            group='y'
            key={label}
            style={buttonStyle}
            title={label}
          >
            {label}
          </VirtualGamepadButton>
        ))}
        {/* The X pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-14 landscape:left-2.5 landscape:size-26.5' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
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
          buttonName='a'
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

      {/* Start and Rotate: above A and B in portrait, under the top right buttons in landscape */}
      <div
        className={twMerge(
          'bottom-safe right-safe landscape:top-safe absolute size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute right-4 bottom-[300px] flex flex-col items-end gap-2 landscape:top-[52px] landscape:right-2.5 landscape:bottom-auto'>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Start'>
            START
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
