import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Game Boy Advance's controls drawn like its own buttons: the d-pad every console shares, pale grey A and B slanted with A
// higher, pale grey L and R shoulders, and Select and Start as pills between the hands in portrait, or beside pause in
// landscape. mGBA and VBA Next read the RetroPad's buttons as the GBA's.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'
const pale = 'radial-gradient(circle at 40% 30%, #ffffff, #d6d6dc 60%, #9a9aa2)'
const paleBar = 'linear-gradient(#e6e6ea, #a8a8b0)'

const shoulder = twMerge(
  pressed,
  'absolute bottom-[262px] h-7.5 w-27.5 rounded-t-[15px] rounded-b-lg text-sm font-extrabold text-[#3a3a40] shadow-[0_2px_4px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[290px] landscape:w-25',
)
const face = twMerge(
  pressed,
  'absolute size-18 rounded-full text-2xl font-extrabold text-[#3a3a40] shadow-[0_3px_4px_#000a,inset_0_-3px_0_#0002] landscape:size-13.5 landscape:text-lg',
)

function Pill({ buttonName, label }: Readonly<{ buttonName: string; label: string }>) {
  return (
    <VirtualGamepadButton
      buttonName={buttonName}
      className={twMerge(
        pressed,
        'flex flex-col items-center gap-1 bg-transparent px-0.5 pt-1 data-[touching=true]:bg-transparent',
      )}
      title={label}
    >
      <span
        className='block h-3.25 w-10.5 rounded-full shadow-[0_2px_3px_#0008] landscape:w-9'
        style={{ background: paleBar }}
      />
      <span className='text-[9px] font-bold tracking-widest text-[#9a9aa2]'>{label}</span>
    </VirtualGamepadButton>
  )
}

export function GbaControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 120 points wide; on smaller screens they shrink towards their corner. The GBA's
  // picture is 3:2, wider than the other consoles', so in landscape it leaves less room beside it. Each group hangs off
  // a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(120, 3 / 2)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(shoulder, 'left-4 landscape:left-3')}
          style={{ background: paleBar }}
          title='L'
        >
          L
        </VirtualGamepadButton>
        {/* The d-pad */}
        <DPad className='absolute bottom-19 left-5.5 size-35 landscape:bottom-22.5 landscape:left-3 landscape:size-27' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(shoulder, 'right-4 landscape:right-3')}
          style={{ background: paleBar }}
          title='R'
        >
          R
        </VirtualGamepadButton>
        {/* B and A, slanted with A higher, as on the GBA */}
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(face, 'right-25 bottom-20 landscape:right-15.5 landscape:bottom-27.5')}
          group='face'
          style={{ background: pale }}
          title='B'
        >
          B
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(face, 'right-4.5 bottom-29 landscape:right-2.5 landscape:bottom-35')}
          group='face'
          style={{ background: pale }}
          title='A'
        >
          A
        </VirtualGamepadButton>
      </div>

      {/* Select and Start: between the shoulders in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-10 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[252px] left-0 flex -translate-x-1/2 gap-3 landscape:top-2 landscape:bottom-auto landscape:left-0 landscape:translate-x-0 landscape:gap-1'>
          <Pill buttonName='select' label='SELECT' />
          <Pill buttonName='start' label='START' />
        </div>
      </div>
    </>
  )
}
