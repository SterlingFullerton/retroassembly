import { clsx } from 'clsx'
import { type CSSProperties, type PointerEvent, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { setVirtualGamepadAxis, setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The ColecoVision's controls: its joystick, two orange fire buttons and, when asked for from the top bar, its 12-key
// keypad. The keypad opens between the game and the controls in portrait, and over the joystick in landscape, since
// nobody steers while pressing a key. It stays open for as many keys as a game needs, until its close button or the
// keypad button beside pause is pressed.
const pressed = 'data-[touching=true]:brightness-75 data-[touching=true]:scale-95'
const fireStyle: CSSProperties = { background: 'radial-gradient(circle at 35% 30%, #ffb070, #f07a2a 60%, #c4521a)' }

// The joystick's directions, as the gamepad's d-pad buttons
const directionButtons = { down: 13, left: 14, right: 15, up: 12 }

// Gearcoleco reads keys 1 to 6, ✱ and # from buttons with keyboard keys of their own; 7 and 8 from the stick clicks;
// and 9 and 0 from the left stick pushed up or down, and left or right
function holdAxis(axis: number) {
  return { handleEnd: () => setVirtualGamepadAxis(axis, 0), handleStart: () => setVirtualGamepadAxis(axis, 1) }
}
function holdButton(index: number) {
  return {
    handleEnd: () => setVirtualGamepadButton(index, false),
    handleStart: () => setVirtualGamepadButton(index, true),
  }
}
const keypadKeys: [string, { buttonName: string } | { handleEnd: () => void; handleStart: () => void }][] = [
  ['1', { buttonName: 'y' }],
  ['2', { buttonName: 'x' }],
  ['3', { buttonName: 'l' }],
  ['4', { buttonName: 'r' }],
  ['5', { buttonName: 'l2' }],
  ['6', { buttonName: 'r2' }],
  ['7', holdButton(10)],
  ['8', holdButton(11)],
  ['9', holdAxis(1)],
  ['✱', { buttonName: 'start' }],
  ['0', holdAxis(0)],
  ['#', { buttonName: 'select' }],
]

function setDirections(directions: Partial<Record<keyof typeof directionButtons, boolean>>) {
  for (const [direction, index] of Object.entries(directionButtons)) {
    setVirtualGamepadButton(index, Boolean(directions[direction as keyof typeof directionButtons]))
  }
}

// A digital joystick, as on the controller: it leans towards the thumb and presses the nearest of eight directions
function Joystick() {
  const knob = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | undefined>(undefined)

  function move(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const reach = rect.width / 2 - 16
    let x = event.clientX - (rect.left + rect.width / 2)
    let y = event.clientY - (rect.top + rect.height / 2)
    const distance = Math.hypot(x, y)
    if (distance > reach) {
      x = (x / distance) * reach
      y = (y / distance) * reach
    }
    if (knob.current) {
      knob.current.style.transform = `translate(${x}px, ${y}px)`
    }
    // Near the middle nothing is pressed; elsewhere, each eighth of the circle presses its one or two directions
    if (distance < reach * 0.3) {
      setDirections({})
      return
    }
    const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4))
    setDirections({
      down: sector >= 1 && sector <= 3,
      left: Math.abs(sector) >= 3,
      right: Math.abs(sector) <= 1,
      up: sector <= -1 && sector >= -3,
    })
  }

  function handleRelease() {
    activePointer.current = undefined
    if (knob.current) {
      knob.current.style.transform = ''
    }
    setDirections({})
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointer.current = event.pointerId
    move(event)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === activePointer.current) {
      move(event)
    }
  }

  return (
    <div
      className='flex size-full touch-none items-center justify-center rounded-full shadow-[inset_0_2px_6px_#000,0_0_0_2px_#333]'
      onPointerCancel={handleRelease}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleRelease}
      style={{ background: 'radial-gradient(circle, #2a2a2c 55%, #1a1a1b 56%, #222 70%, #111)' }}
      title='Joystick'
    >
      <div
        className='pointer-events-none size-[45%] rounded-full shadow-[0_4px_8px_#000c,inset_0_1px_0_#ffffff30]'
        ref={knob}
        style={{ background: 'repeating-conic-gradient(#2f2f31 0 10deg, #1d1d1f 10deg 20deg)' }}
      />
    </div>
  )
}

export function ColecoVisionControls({
  keypadOpen,
  onKeypadClose,
  visible,
}: Readonly<{ keypadOpen: boolean; onKeypadClose: () => void; visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <div className='absolute bottom-14 left-5 size-37.5 landscape:bottom-18 landscape:left-3 landscape:size-35'>
          <Joystick />
        </div>
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-22 bottom-16 size-18.5 rounded-full text-sm font-bold text-[#3a1a00] shadow-[0_3px_5px_#0009,inset_0_1px_0_#fff8]',
            'landscape:right-22 landscape:bottom-18 landscape:size-17',
          )}
          group='fire'
          style={fireStyle}
          title='Fire left'
        >
          L
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            pressed,
            'absolute right-1 bottom-32 size-21 rounded-full text-sm font-bold text-[#3a1a00] shadow-[0_3px_5px_#0009,inset_0_1px_0_#fff8]',
            'landscape:right-2 landscape:bottom-34 landscape:size-19',
          )}
          group='fire'
          style={fireStyle}
          title='Fire right'
        >
          R
        </VirtualGamepadButton>
      </div>

      {keypadOpen && visible ? (
        // Hangs off the middle of the bottom in portrait, and off the top left corner in landscape
        <div
          className='bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto'
          style={{ scale }}
        >
          <div
            className={twMerge(
              'absolute bottom-64 left-0 grid w-65 -translate-x-1/2 grid-cols-3 gap-2 rounded-xl bg-[#2a2a2c] p-3 shadow-[0_10px_30px_#000c] outline-2 outline-[#ff9a4a55]',
              'landscape:top-13 landscape:bottom-auto landscape:left-2 landscape:w-37 landscape:translate-x-0',
            )}
          >
            <div className='col-span-3 -mt-1 flex items-center justify-between pl-1 text-xs font-semibold tracking-wide text-white/60 uppercase'>
              Keypad
              <button
                className='-mr-1 flex size-8 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/30'
                onClick={onKeypadClose}
                aria-label='Close keypad'
                title='Close keypad'
                type='button'
              >
                <span className='icon-[mdi--close] size-5' />
              </button>
            </div>
            {keypadKeys.map(([label, key]) => (
              <VirtualGamepadButton
                buttonName={'buttonName' in key ? key.buttonName : undefined}
                className={twMerge(
                  pressed,
                  'h-11.5 rounded-md text-base font-bold text-[#f2f2f2] shadow-[0_2px_2px_#000a,inset_0_1px_0_#ffffff1a] landscape:h-12',
                )}
                group='keypad'
                key={label}
                onVirtualPressEnd={'handleEnd' in key ? key.handleEnd : undefined}
                onVirtualPressStart={'handleStart' in key ? key.handleStart : undefined}
                style={{ background: 'linear-gradient(#232325, #111)' }}
                title={`Keypad ${label}`}
              >
                {label}
              </VirtualGamepadButton>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
