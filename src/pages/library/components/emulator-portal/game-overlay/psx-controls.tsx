import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { Thumbstick } from './thumbstick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The PlayStation's controls drawn like a DualShock: the d-pad every console shares, the four face buttons in their
// diamond with their coloured symbols, L1 and R1 as short flat bumpers with the taller L2 and R2 triggers behind them,
// the two analog sticks below, and plain Select and Start between the hands in portrait, or beside pause in landscape.
// PCSX ReARMed reads □, △, ✕ and ○ from the RetroPad's Y, X, B and A, and is told the controller is a DualShock, whose
// sticks games switch on themselves.
const pressed = 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95'

// Each face button: its symbol and colour, and its place in the diamond in portrait and in landscape
const faceButtons: [label: string, buttonName: string, color: string, className: string][] = [
  ['△', 'x', '#3fcf8e', 'right-[64px] bottom-[274px] landscape:right-[48px] landscape:bottom-[244px]'],
  ['□', 'y', '#e88ac8', 'right-[112px] bottom-[226px] landscape:right-[86px] landscape:bottom-[206px]'],
  ['○', 'a', '#ff5a5a', 'right-[16px] bottom-[226px] landscape:right-[10px] landscape:bottom-[206px]'],
  ['✕', 'b', '#7aa8ff', 'right-[64px] bottom-[178px] landscape:right-[48px] landscape:bottom-[168px]'],
]
const faceStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #4a4a52, #2a2a30 60%, #18181c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ffffff22, inset 0 -3px 0 #0006',
}

// The bumpers are short, flat and light; the triggers taller, darker and curved, sitting behind and above them
const bumper = twMerge(
  pressed,
  'absolute bottom-[336px] h-5.5 w-35 rounded-md text-[11px] font-extrabold text-[#3a3a40] shadow-[0_2px_3px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[284px] landscape:w-33',
)
const bumperStyle: CSSProperties = { background: 'linear-gradient(#e6e6ea, #b4b4bc)' }
const trigger = twMerge(
  pressed,
  'absolute bottom-[364px] flex h-8 w-35 items-start justify-center rounded-t-[18px] rounded-b-md pt-1.25 text-[11px] font-extrabold text-[#d8d8de] shadow-[0_2px_4px_#0009,inset_0_1px_0_#ffffff40]',
  'landscape:bottom-[312px] landscape:w-33',
)
const triggerStyle: CSSProperties = { background: 'linear-gradient(#7a7a84, #4a4a52)' }

const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
  'landscape:px-1.5 landscape:text-[9px] landscape:tracking-wide',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

export function PsxControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 150 points wide, and 450 tall in portrait, up to Select and Start; on smaller screens
  // they shrink towards their corner, and on short phones enough to stay below the game. Each group hangs off a point
  // with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(150, 4 / 3, 450)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
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
        <DPad className='absolute bottom-[186px] left-5 size-34 landscape:bottom-[170px] landscape:left-4 landscape:size-27.5' />
        <Thumbstick
          className='absolute bottom-7 left-16 size-30 landscape:bottom-6.5 landscape:left-10 landscape:size-26'
          stick='left'
        />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
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
            className={twMerge(
              pressed,
              'absolute size-11.5 rounded-full text-xl font-bold landscape:size-9 landscape:text-base',
              className,
            )}
            group='face'
            key={label}
            style={{ ...faceStyle, color }}
            title={label}
          >
            {label}
          </VirtualGamepadButton>
        ))}
        <Thumbstick
          className='absolute right-16 bottom-7 size-30 landscape:right-10 landscape:bottom-6.5 landscape:size-26'
          stick='right'
        />
      </div>

      {/* Select and Start: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[420px] left-0 flex -translate-x-1/2 gap-2 landscape:top-3 landscape:bottom-auto landscape:translate-x-0 landscape:gap-1'>
          <VirtualGamepadButton buttonName='select' className={plain} style={plainStyle} title='Select'>
            SELECT
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Start'>
            START
          </VirtualGamepadButton>
        </div>
      </div>
    </>
  )
}
