import { clsx } from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { setVirtualGamepadAxis } from '#@/emulator/on-screen-gamepad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { pressedLook, useStick } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The N64's controls drawn like its controller: grey L, Z and R, a black cross D-pad, a grey stick in its octagonal
// gate, four small yellow C buttons, a green B, a big blue A and a red Start. A pressed button darkens. The stick sits
// low in the left hand with the D-pad at the edge above it, and Z just under R. Start is in the top bar beside pause.
const pressed = pressedLook(75)
const shoulder = twMerge(
  pressed,
  'h-7.5 rounded-t-2xl rounded-b-lg text-[13px] font-bold text-[#2b2d31] shadow-[inset_0_1px_0_#fff8,0_2px_3px_#0006]',
)
const shoulderStyle: CSSProperties = { background: 'linear-gradient(#c9cbce, #9da0a4)' }
const roundButton = twMerge(
  pressed,
  'absolute rounded-full font-bold text-white shadow-[0_3px_4px_#0009,inset_0_1px_0_#ffffff55]',
)

function gloss(light: string, base: string, dark: string): CSSProperties {
  return { background: `radial-gradient(circle at 35% 30%, ${light}, ${base} 65%, ${dark})` }
}

// The C buttons are the right stick on the N64 emulator, pushed all the way. These stay the same between renders,
// since the buttons re-register whenever their callbacks change
const cButtons = {
  down: { handleEnd: () => setVirtualGamepadAxis(3, 0), handleStart: () => setVirtualGamepadAxis(3, 1) },
  left: { handleEnd: () => setVirtualGamepadAxis(2, 0), handleStart: () => setVirtualGamepadAxis(2, -1) },
  right: { handleEnd: () => setVirtualGamepadAxis(2, 0), handleStart: () => setVirtualGamepadAxis(2, 1) },
  up: { handleEnd: () => setVirtualGamepadAxis(3, 0), handleStart: () => setVirtualGamepadAxis(3, -1) },
}

function CButton({
  children,
  className,
  direction,
}: Readonly<{ children: ReactNode; className: string; direction: keyof typeof cButtons }>) {
  return (
    <VirtualGamepadButton
      className={twMerge(roundButton, 'size-9.5 text-xs text-[#6b5300]', className)}
      group='face'
      onVirtualPressEnd={cButtons[direction].handleEnd}
      onVirtualPressStart={cButtons[direction].handleStart}
      style={gloss('#ffe680', '#f2c21a', '#c99a00')}
      title={`C ${direction}`}
    >
      {children}
    </VirtualGamepadButton>
  )
}

// A stick that follows the thumb: how far it's pushed from the middle is how far the game's stick tilts
function AnalogStick() {
  const { handlers, knob } = useStick({
    onMove(x, y) {
      setVirtualGamepadAxis(0, x)
      setVirtualGamepadAxis(1, y)
    },
    onRelease() {
      setVirtualGamepadAxis(0, 0)
      setVirtualGamepadAxis(1, 0)
    },
    reach: (width) => width / 2 - 14,
  })

  return (
    <div
      className='flex size-29 touch-none items-center justify-center bg-[#2c2e33] [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)]'
      {...handlers}
      title='Analog stick'
    >
      <div
        className='pointer-events-none size-15.5 rounded-full shadow-[0_3px_6px_#000a,inset_0_1px_0_#fff8]'
        ref={knob}
        style={{ background: 'repeating-radial-gradient(circle, #b8babd 0 3px, #a3a6aa 3px 6px)' }}
      />
    </div>
  )
}

export function N64Controls({ visible }: Readonly<{ visible: boolean }>) {
  // Each hand's column is 184 points wide; on smaller screens they shrink from their corners
  const scale = useControlsScale(184)
  return (
    <>
      <div
        className={twMerge(
          'bottom-safe left-safe absolute flex w-46 origin-bottom-left flex-col gap-2 p-2',
          clsx({ hidden: !visible }),
        )}
        style={{ scale }}
      >
        <VirtualGamepadButton buttonName='l' className={shoulder} style={shoulderStyle}>
          L
        </VirtualGamepadButton>
        {/* The D-pad at the left edge, the stick below it towards the middle, where the left thumb rests */}
        <div className='relative h-59'>
          {/* The d-pad */}
          <DPad className='absolute top-0 left-0 size-24' />
          <div className='absolute bottom-0 left-1/2 -translate-x-1/2'>
            <AnalogStick />
          </div>
        </div>
      </div>

      <div
        className={twMerge(
          'bottom-safe right-safe absolute flex w-46 origin-bottom-right flex-col gap-2 p-2',
          clsx({ hidden: !visible }),
        )}
        style={{ scale }}
      >
        <VirtualGamepadButton buttonName='r' className={shoulder} style={shoulderStyle}>
          R
        </VirtualGamepadButton>
        {/* As tall as the left hand's controls, so L and R line up; the buttons sit at its foot */}
        <div className='relative h-59'>
          {/* Z is by the right thumb rather than on the left shoulder: the left thumb is on the stick, and Z is usually
              pressed with B or A. It sits just under R, above the C buttons. Being in the same group as them, a thumb
              can roll between them */}
          <VirtualGamepadButton
            buttonName='l2'
            className={twMerge(
              pressed,
              'absolute top-0 left-0 h-9 w-14 rounded-xl text-[15px] font-bold text-[#e9e9e9] shadow-[inset_0_1px_0_#fff6,0_2px_3px_#0006]',
            )}
            group='face'
            style={{ background: 'linear-gradient(#7b7e83, #5e6166)' }}
          >
            Z
          </VirtualGamepadButton>
          <div className='absolute inset-x-0 bottom-0 h-52'>
            <CButton className='top-0 left-[98px]' direction='up'>
              ▲
            </CButton>
            <CButton className='top-9.5 left-[60px]' direction='left'>
              ◀
            </CButton>
            <CButton className='top-9.5 left-[136px]' direction='right'>
              ▶
            </CButton>
            <CButton className='top-19 left-[98px]' direction='down'>
              ▼
            </CButton>
            <VirtualGamepadButton
              buttonName='y'
              className={twMerge(roundButton, 'top-29 left-4.5 size-13 text-[17px]')}
              group='face'
              style={gloss('#56d36d', '#1d9a35', '#146b25')}
            >
              B
            </VirtualGamepadButton>
            <VirtualGamepadButton
              buttonName='b'
              className={twMerge(roundButton, 'top-35 left-19 size-16.5 text-xl')}
              group='face'
              style={gloss('#5d8cff', '#1f4fd6', '#163a9e')}
            >
              A
            </VirtualGamepadButton>
          </div>
        </div>
      </div>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
