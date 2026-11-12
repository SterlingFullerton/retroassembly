import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Game Boy's controls drawn like its own buttons: the d-pad every console shares, berry-coloured B and A with their letters
// printed beside them, and grey slanted Select and Start between the hands in portrait, or beside pause in landscape.
// B and A are slanted along the arc the thumb makes rolling from one to the other, as on the NES's. Game Boy Color
// games share them. Every Game Boy emulator reads the RetroPad's B, A, Select and Start as the Game Boy's.
const berry = '#d0508a'

const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'

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
        className='block h-3.25 w-10.5 -rotate-25 rounded-full shadow-[0_2px_3px_#0008]'
        style={{ background: 'linear-gradient(#9a9aa2, #6a6a72)' }}
      />
      <span className='text-[9px] font-bold tracking-widest text-[#9a9aa2]'>{label}</span>
    </VirtualGamepadButton>
  )
}

export function GbControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. The Game Boy's
  // picture is almost square (10:9), so in landscape it leaves more room beside it. Each group hangs off a point with
  // no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160, 10 / 9)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #e05a95, #a3205e 60%, #6a1038)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #f090bb, inset 0 -3px 0 #0004',
  }
  const letter = 'absolute font-black text-lg landscape:text-base'

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </div>

      {/* B and A, slanted, with their letters printed below and to the right as on the Game Boy */}
      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-27 bottom-19 size-19.5 rounded-full landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='B'
        />
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            pressed,
            'absolute right-4.5 bottom-29 size-19.5 rounded-full landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='face'
          style={buttonStyle}
          title='A'
        />
        <span
          className={twMerge(letter, 'right-35 bottom-12.5 landscape:right-27 landscape:bottom-11.5')}
          style={{ color: berry }}
        >
          B
        </span>
        <span
          className={twMerge(letter, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: berry }}
        >
          A
        </span>
      </div>

      {/* Select and Start: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[252px] left-0 flex -translate-x-1/2 gap-2.5 landscape:top-2 landscape:bottom-auto landscape:translate-x-0'>
          <Pill buttonName='select' label='SELECT' />
          <Pill buttonName='start' label='START' />
        </div>
      </div>
    </>
  )
}
