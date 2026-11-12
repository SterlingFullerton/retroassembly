import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { setVirtualGamepadAxis, setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The ColecoVision's controls: its joystick, two orange fire buttons and, when asked for from the top bar, its 12-key
// keypad. The keypad opens between the game and the controls in portrait, and over the joystick in landscape, since
// nobody steers while pressing a key. It stays open for as many keys as a game needs, until its close button or the
// keypad button beside pause is pressed.
const pressed = 'data-[touching=true]:brightness-75 data-[touching=true]:scale-95'
const fireStyle: CSSProperties = { background: 'radial-gradient(circle at 35% 30%, #ffb070, #f07a2a 60%, #c4521a)' }

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
