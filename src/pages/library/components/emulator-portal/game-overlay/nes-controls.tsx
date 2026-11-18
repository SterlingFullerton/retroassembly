import { type CSSProperties, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { setVirtualGamepadButton } from '#@/emulator/on-screen-gamepad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook, SlantedPair } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'

// The NES's controls drawn like its controller: the d-pad every console shares, round B and A buttons with their
// letters printed beside them, and Select and Start in the top bar beside pause. B and A are slanted along the arc the thumb makes rolling from one to the other. Every NES emulator reads
// the RetroPad's B, A, Select and Start as the controller's. Disk System games add Flip disk, labelled FLIP, after
// them.
const red = '#e0242a'

const pressed = pressedLook(90)

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
    <TopBarButton onVirtualPressStart={flip} title='Flip disk'>
      FLIP
    </TopBarButton>
  )
}

/** The NES's controls; `diskCore`, for Disk System games, adds the flip disk button for that emulator */
export function NesControls({ diskCore, visible }: Readonly<{ diskCore?: string; visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  const buttonStyle: CSSProperties = {
    background: 'radial-gradient(circle at 40% 30%, #ff5a5a, #d01818 60%, #8a0c0c)',
    boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ff9a9a, inset 0 -3px 0 #0004',
  }

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        {/* The d-pad */}
        <DPad className='absolute bottom-17 left-4.5 size-40 landscape:bottom-16 landscape:left-3 landscape:size-34' />
      </Corner>

      {/* B and A, slanted, with their letters printed below and to the right as on the controller */}
      <Corner scale={scale} side='right' visible={visible}>
        <SlantedPair
          buttons={[
            { buttonName: 'b', label: 'B' },
            { buttonName: 'a', label: 'A' },
          ]}
          className={twMerge(pressed, 'absolute rounded-full')}
          printed={red}
          style={buttonStyle}
        />
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
        {diskCore ? <FlipDiskButton core={diskCore} /> : null}
      </TopBarButtons>
    </>
  )
}
