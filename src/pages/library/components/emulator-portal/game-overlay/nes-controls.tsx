import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The NES's controls drawn like its controller: a black d-pad cross on a square, round B and A buttons with their
// letters printed beside them, and Select and Start as rubber pills between the hands in portrait, or beside pause in
// landscape. B and A are slanted along the arc the thumb makes rolling from one to the other. Every NES emulator reads
// the RetroPad's B, A, Select and Start as the controller's.
const grey = 'linear-gradient(#cfcfd3, #a9a9af)'
const red = '#e0242a'

const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'
// The d-pad's arms light up when pressed rather than shrinking, which would open a gap between them
const arm = 'text-[11px] text-[#6a6a70] data-[touching=true]:brightness-200'
const armStyle: CSSProperties = { background: 'linear-gradient(#2c2c2f, #111113)' }
const diagonal = 'bg-transparent data-[touching=true]:bg-black/10'

function Pill({ buttonName, label }: Readonly<{ buttonName: string; label: string }>) {
  return (
    <VirtualGamepadButton
      buttonName={buttonName}
      className={twMerge(
        pressed,
        'flex flex-col items-center gap-1 bg-transparent px-0.5 data-[touching=true]:bg-transparent',
      )}
      title={label}
    >
      <span className='text-[9px] font-extrabold tracking-[0.12em]' style={{ color: red }}>
        {label}
      </span>
      <span
        className='block h-3.5 w-11 rounded-full shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff20]'
        style={{ background: 'linear-gradient(#3a3a3e, #121214)' }}
      />
    </VirtualGamepadButton>
  )
}

export function NesControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #ff5a5a, #d01818 60%, #8a0c0c)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ff9a9a, inset 0 -3px 0 #0004',
  }
  const letter = 'absolute font-black text-lg landscape:text-base'

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        {/* The d-pad: a cross on a square; its corners press two directions at once */}
        <div
          className='absolute bottom-17.5 left-4.5 size-37.5 rounded-[10px] shadow-[inset_0_1px_0_#fff,0_2px_4px_#0008] landscape:bottom-16.5 landscape:left-3 landscape:size-33'
          style={{ background: grey }}
        >
          <div className='absolute inset-[12%] grid grid-cols-3 grid-rows-3'>
            <VirtualGamepadButton
              buttonNames={['up', 'left']}
              className={twMerge(diagonal, 'rounded-tl-md')}
              group='dpad'
              title='up,left'
            />
            <VirtualGamepadButton
              buttonName='up'
              className={twMerge(arm, 'rounded-t-sm')}
              group='dpad'
              style={armStyle}
              title='up'
            >
              ▲
            </VirtualGamepadButton>
            <VirtualGamepadButton
              buttonNames={['right', 'up']}
              className={twMerge(diagonal, 'rounded-tr-md')}
              group='dpad'
              title='right,up'
            />
            <VirtualGamepadButton
              buttonName='left'
              className={twMerge(arm, 'rounded-l-sm')}
              group='dpad'
              style={armStyle}
              title='left'
            >
              ◀
            </VirtualGamepadButton>
            <div style={armStyle} />
            <VirtualGamepadButton
              buttonName='right'
              className={twMerge(arm, 'rounded-r-sm')}
              group='dpad'
              style={armStyle}
              title='right'
            >
              ▶
            </VirtualGamepadButton>
            <VirtualGamepadButton
              buttonNames={['left', 'down']}
              className={twMerge(diagonal, 'rounded-bl-md')}
              group='dpad'
              title='left,down'
            />
            <VirtualGamepadButton
              buttonName='down'
              className={twMerge(arm, 'rounded-b-sm')}
              group='dpad'
              style={armStyle}
              title='down'
            >
              ▼
            </VirtualGamepadButton>
            <VirtualGamepadButton
              buttonNames={['right', 'down']}
              className={twMerge(diagonal, 'rounded-br-md')}
              group='dpad'
              title='right,down'
            />
          </div>
        </div>
      </div>

      {/* B and A, slanted, with their letters printed below and to the right as on the controller */}
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
          style={{ color: red }}
        >
          B
        </span>
        <span
          className={twMerge(letter, 'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20')}
          style={{ color: red }}
        >
          A
        </span>
      </div>

      {/* Select and Start: on a strip between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div
          className='absolute bottom-[246px] left-0 h-11 w-33 -translate-x-1/2 rounded-lg shadow-[inset_0_1px_0_#fff,0_2px_4px_#0008] landscape:hidden'
          style={{ background: grey }}
        />
        <div className='absolute bottom-[252px] left-0 flex -translate-x-1/2 gap-3.5 landscape:top-2 landscape:bottom-auto landscape:translate-x-0'>
          <Pill buttonName='select' label='SELECT' />
          <Pill buttonName='start' label='START' />
        </div>
      </div>
    </>
  )
}
