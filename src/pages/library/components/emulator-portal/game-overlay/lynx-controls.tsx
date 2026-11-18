import { clsx } from 'clsx'
import type { CSSProperties, RefObject } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { refitGame } from './refit-game.ts'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari Lynx's controls, in the WonderSwan's style: the d-pad every console shares, dark grey B and A slanted along
// the arc the thumb makes rolling from one to the other, and Option 1, Option 2, Pause and Rotate in the top bar
// beside pause, shortened to OPT 1 and OPT 2 so the bar fits. Rotate turns the picture for games played with the
// Lynx held upright, and the d-pad with it. Beetle Lynx reads A from the RetroPad's B, B from A, Option 1 and 2 from L
// and R, Pause from Start and Rotate from Select.
const pressed = pressedLook(125)
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const round = twMerge(pressed, 'absolute rounded-full font-extrabold text-[#e8e8ea]')

export function LynxControls({ top, visible }: Readonly<{ top: RefObject<HTMLDivElement | null>; visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 120 points wide in landscape; the Lynx's picture is wide (about 16:10), which leaves
  // little room beside it. On smaller screens they shrink towards their corner. Each group hangs off a point with no
  // size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 160 / 102)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-14 landscape:left-2.5 landscape:size-26.5' />
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
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
      </Corner>

      {/* Marks the top of the controls, so that in portrait the game, upright or not, fits above them */}
      <div
        className={twMerge('bottom-safe absolute left-1/2 size-0 origin-top-left landscape:hidden', hidden)}
        style={{ scale }}
      >
        <div className='absolute bottom-[334px] left-0 h-px w-px' ref={top} />
      </div>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='l' title='Option 1'>
          OPT 1
        </TopBarButton>
        <TopBarButton buttonName='r' title='Option 2'>
          OPT 2
        </TopBarButton>
        <TopBarButton buttonName='start' title='Pause'>
          PAUSE
        </TopBarButton>
        <TopBarButton buttonName='select' onVirtualPressEnd={refitGame} title='Rotate'>
          ROTATE
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
