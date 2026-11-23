import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { Thumbstick } from './thumbstick.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The PlayStation's controls drawn like a DualShock: the d-pad every console shares, the four face buttons in their
// diamond with their coloured symbols, L1 and R1 as short flat bumpers with the taller L2 and R2 triggers behind them,
// the two analog sticks below, and Select and Start in the top bar beside pause.
// PCSX ReARMed reads □, △, ✕ and ○ from the RetroPad's Y, X, B and A, and is told the controller is a DualShock, whose
// sticks games switch on themselves.
export const pressed = pressedLook(125)

// Each face button: its symbol and colour, and its place in the diamond in portrait and in landscape. The diamond, like
// the d-pad, sits midway between the bumpers above and the sticks below
export const faceButtons: [label: string, buttonName: RetroPadButton, color: string, className: string][] = [
  ['△', 'x', '#3fcf8e', 'right-[64px] bottom-[267px] landscape:bottom-[212px]'],
  ['□', 'y', '#e88ac8', 'right-[112px] bottom-[219px] landscape:bottom-[164px]'],
  ['○', 'a', '#ff5a5a', 'right-[16px] bottom-[219px] landscape:bottom-[164px]'],
  ['✕', 'b', '#7aa8ff', 'right-[64px] bottom-[171px] landscape:bottom-[116px]'],
]
export const faceStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #4a4a52, #2a2a30 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff22, inset 0 -3px 0 #0006',
}

// The bumpers are short, flat and light; the triggers taller, darker and curved, sitting behind and above them
export const bumper = twMerge(
  pressed,
  'touch-tall-down absolute bottom-[336px] h-5.5 w-35 rounded-md text-[11px] font-extrabold text-[#3a3a40] shadow-[0_2px_3px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[260px] landscape:w-33',
)
export const bumperStyle: CSSProperties = { background: 'linear-gradient(#e6e6ea, #b4b4bc)' }
const trigger = twMerge(
  pressed,
  'touch-tall-up absolute bottom-[364px] flex h-8 w-35 items-start justify-center rounded-t-[18px] rounded-b-md pt-1.25 text-[11px] font-extrabold text-[#d8d8de] shadow-[0_2px_4px_#0009,inset_0_1px_0_#ffffff40]',
  'landscape:bottom-[288px] landscape:w-33',
)
const triggerStyle: CSSProperties = { background: 'linear-gradient(#7a7a84, #4a4a52)' }

export function PsxControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 150 points wide, and 450 tall in portrait, up to Select and Start; on smaller screens
  // they shrink towards their corner, and on short phones enough to stay below the game. Each group hangs off a point
  // with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(4 / 3, { portraitHeight: 450 })

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <VirtualGamepadButton
          buttonName='l2'
          className={twMerge(trigger, 'left-4 landscape:left-3')}
          style={triggerStyle}
        >
          L2
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='l' className={twMerge(bumper, 'left-4 landscape:left-3')} style={bumperStyle}>
          L1
        </VirtualGamepadButton>
        <DPad className='absolute bottom-[174px] left-5 size-34 landscape:bottom-[120px] landscape:left-4 landscape:size-33' />
        <Thumbstick
          className='absolute bottom-7 left-16 size-30 landscape:bottom-2 landscape:left-10 landscape:size-26'
          stick='left'
        />
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        <VirtualGamepadButton
          buttonName='r2'
          className={twMerge(trigger, 'right-4 landscape:right-3')}
          style={triggerStyle}
        >
          R2
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(bumper, 'right-4 landscape:right-3')}
          style={bumperStyle}
        >
          R1
        </VirtualGamepadButton>
        {faceButtons.map(([label, buttonName, color, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(pressed, 'absolute size-11.5 rounded-full text-xl font-bold', className)}
            group='face'
            key={label}
            style={{ ...faceStyle, color }}
            title={label}
          >
            {label}
          </VirtualGamepadButton>
        ))}
        <Thumbstick
          className='absolute right-16 bottom-7 size-30 landscape:right-10 landscape:bottom-2 landscape:size-26'
          stick='right'
        />
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
