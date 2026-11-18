import type { CSSProperties, RefObject } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { refitGame } from './refit-game.ts'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The WonderSwan's controls: the d-pad every console shares as the X pad, the Y pad as four buttons in a diamond above
// it, dark grey B and A slanted along the arc the thumb makes rolling from one to the other, and Start and Rotate in the top bar beside pause.
// Rotate turns the picture for games played upright, and Beetle WonderSwan turns the X pad with it, so the d-pad still
// steers. It reads the X pad from the d-pad, Y1 to Y4 (up, right, down, left) from R2, R, L2 and L, A and B from A and
// B, and Start and Rotate from Start and Select. WonderSwan Color games share them.
const pressed = pressedLook(125)
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full font-extrabold text-[#e8e8ea]')

// The Y pad: each button's RetroPad button and its place in portrait and in landscape
const yButtons: [label: string, buttonName: RetroPadButton, className: string][] = [
  ['Y1', 'r2', 'left-[75px] bottom-[335px] landscape:left-[45px] landscape:bottom-[240px]'],
  ['Y2', 'r', 'left-[121px] bottom-[289px] landscape:left-[81px] landscape:bottom-[204px]'],
  ['Y3', 'l2', 'left-[75px] bottom-[243px] landscape:left-[45px] landscape:bottom-[168px]'],
  ['Y4', 'l', 'left-[29px] bottom-[289px] landscape:left-[9px] landscape:bottom-[204px]'],
]

export function WonderSwanControls({
  top,
  visible,
}: Readonly<{ top: RefObject<HTMLDivElement | null>; visible: boolean }>) {
  // Each side's controls are about 120 points wide in landscape; the WonderSwan's picture is wide (14:9), which leaves
  // little room beside it. On smaller screens they shrink towards their corner. Each group hangs off a point with no
  // size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 14 / 9)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
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
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
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
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start'>START</TopBarButton>
        <TopBarButton buttonName='select' title='Rotate' onVirtualPressEnd={refitGame}>
          ROTATE
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
