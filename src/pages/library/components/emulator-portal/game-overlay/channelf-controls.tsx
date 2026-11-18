import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { Joystick } from './joystick.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Channel F's controls: its stick is a joystick that also pushes down, pulls up and twists either way. The
// joystick presses eight directions, as on the Atari; the other moves are four buttons in a diamond laid out like them,
// pull on top, push below and the twists at the sides. Console and Swap sit in the top bar beside
// pause: Console switches to the console's own buttons 1 to 4, which the joystick then
// picks between and a diamond button presses, and Swap swaps the left and right controllers. FreeChaF reads push from
// B, pull from X, twist left and right from Y and A, Swap from Select and Console from Start.
const pressed = pressedLook(125)
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}

// Each move: its arrow, name, RetroPad button and place in the diamond in portrait and in landscape
const moves: [arrow: string, name: string, buttonName: RetroPadButton, className: string][] = [
  ['↑', 'Pull', 'x', 'right-[75px] bottom-[169px] landscape:right-[61px] landscape:bottom-[155px]'],
  ['↺', 'Twist left', 'y', 'right-[131px] bottom-[113px] landscape:right-[107px] landscape:bottom-[109px]'],
  ['↻', 'Twist right', 'a', 'right-[19px] bottom-[113px] landscape:right-[15px] landscape:bottom-[109px]'],
  ['↓', 'Push', 'b', 'right-[75px] bottom-[57px] landscape:right-[61px] landscape:bottom-[63px]'],
]

export function ChannelFControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Channel
  // F's picture is wider than 4:3, about 102 by 64, so in landscape it leaves less room beside it. Each group hangs off
  // a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 102 / 64)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <div className='absolute bottom-16 left-5 size-37.5 landscape:bottom-15 landscape:left-3 landscape:size-34'>
          <Joystick />
        </div>
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        {moves.map(([arrow, name, buttonName, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(
              pressed,
              'absolute flex size-13.5 flex-col rounded-full text-[19px] leading-none font-extrabold text-[#e8e8ea] landscape:size-11 landscape:text-base',
              className,
            )}
            group='moves'
            key={name}
            style={buttonStyle}
            title={name}
          >
            {arrow}
            <span className='text-[9px] font-bold tracking-wide text-[#b8b8c0]'>
              {name.startsWith('Twist') ? 'TWIST' : name.toUpperCase()}
            </span>
          </VirtualGamepadButton>
        ))}
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start' title='Console'>
          CONSOLE
        </TopBarButton>
        <TopBarButton buttonName='select' title='Swap'>
          SWAP
        </TopBarButton>
      </TopBarButtons>
    </>
  )
}
