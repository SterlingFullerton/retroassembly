import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Channel F's controls: its stick is a joystick that also pushes down, pulls up and twists either way. The
// joystick presses eight directions, as on the Atari; the other moves are four buttons in a diamond laid out like them,
// pull on top, push below and the twists at the sides. Plain Console and Swap sit between the hands in portrait, or
// stacked under pause in landscape: Console switches to the console's own buttons 1 to 4, which the joystick then
// picks between and a diamond button presses, and Swap swaps the left and right controllers. FreeChaF reads push from
// B, pull from X, twist left and right from Y and A, Swap from Select and Console from Start.
const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'
const buttonStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #5a5a62, #2e2e34 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff30, inset 0 -3px 0 #0006',
}
const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

// Each move: its arrow, name, RetroPad button and place in the diamond in portrait and in landscape
const moves: [arrow: string, name: string, buttonName: string, className: string][] = [
  ['↑', 'Pull', 'x', 'right-[75px] bottom-[169px] landscape:right-[61px] landscape:bottom-[155px]'],
  ['↺', 'Twist left', 'y', 'right-[131px] bottom-[113px] landscape:right-[107px] landscape:bottom-[109px]'],
  ['↻', 'Twist right', 'a', 'right-[19px] bottom-[113px] landscape:right-[15px] landscape:bottom-[109px]'],
  ['↓', 'Push', 'b', 'right-[75px] bottom-[57px] landscape:right-[61px] landscape:bottom-[63px]'],
]

export function ChannelFControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Channel
  // F's picture is wider than 4:3, about 102 by 64, so in landscape it leaves less room beside it. Each group hangs off
  // a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 102 / 64)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <div className='absolute bottom-16 left-5 size-37.5 landscape:bottom-15 landscape:left-3 landscape:size-34'>
          <Joystick />
        </div>
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
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
      </div>

      {/* Console and Swap: side by side between the hands in portrait, stacked under pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 flex -translate-x-1/2 gap-2 landscape:top-[52px] landscape:bottom-auto landscape:left-3 landscape:translate-x-0 landscape:flex-col landscape:items-start'>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Console'>
            CONSOLE
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='select' className={plain} style={plainStyle} title='Swap'>
            SWAP
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
