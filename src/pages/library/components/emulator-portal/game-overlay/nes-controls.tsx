import { clsx } from 'clsx'
import { type CSSProperties, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The NES's controls drawn like its controller: the d-pad every console shares, round B and A buttons with their
// letters printed beside them, and Select and Start as rubber pills between the hands in portrait, or beside pause in
// landscape. B and A are slanted along the arc the thumb makes rolling from one to the other. Every NES emulator reads
// the RetroPad's B, A, Select and Start as the controller's. Disk System games add a plain Flip disk button, above
// Select and Start in portrait or under pause in landscape.
const grey = 'linear-gradient(#cfcfd3, #a9a9af)'
const red = '#e0242a'

const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'

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

// The standard gamepad's L and R, which both Disk System emulators read the disk from
const l = 4
const r = 5

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

// Holds a button long enough for the emulator to see it, then lets go long enough for the game to notice
async function tap(index: number) {
  setVirtualGamepadButton(index, true)
  await wait(150)
  setVirtualGamepadButton(index, false)
  await wait(400)
}

// Moves on to the next side: disk 1 side A, side B, disk 2 side A, side B, and back. FCEUmm picks the next of every
// side with L, but only with the disk out, which R takes out and puts back in. Nestopia turns the disk over with L,
// with the disk in, and puts in the other disk with R, if there is one. So on Nestopia every other press turns the disk
// over, back to side A, and puts in the other disk, which on a game with one disk leaves it on side A.
function FlipDiskButton({ core }: Readonly<{ core: string }>) {
  const presses = useRef(0)
  const flipping = useRef(false)

  async function flip() {
    if (flipping.current) {
      return
    }
    flipping.current = true
    presses.current += 1
    if (core === 'nestopia') {
      await tap(l)
      if (presses.current % 2 === 0) {
        await tap(r)
      }
    } else {
      await tap(r)
      await tap(l)
      await tap(r)
    }
    flipping.current = false
  }

  return (
    <VirtualGamepadButton
      className={twMerge(
        pressed,
        'flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold tracking-wider whitespace-nowrap text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
      )}
      onVirtualPressStart={flip}
      style={{ background: 'linear-gradient(#3a3a3d, #202022)' }}
      title='Flip disk'
    >
      <span className='icon-[mdi--eject] size-3.5' />
      FLIP DISK
    </VirtualGamepadButton>
  )
}

/** The NES's controls; `diskCore`, for Disk System games, adds the flip disk button for that emulator */
export function NesControls({ diskCore, visible }: Readonly<{ diskCore?: string; visible: boolean }>) {
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
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
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

      {diskCore ? (
        // Above Select and Start in portrait, under pause in landscape
        <div
          className={twMerge(
            'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
            hidden,
          )}
          style={{ scale }}
        >
          <div className='absolute bottom-[306px] left-0 -translate-x-1/2 landscape:top-[52px] landscape:bottom-auto landscape:left-3 landscape:translate-x-0'>
            <FlipDiskButton core={diskCore} />
          </div>
        </div>
      ) : null}
    </>
  )
}
