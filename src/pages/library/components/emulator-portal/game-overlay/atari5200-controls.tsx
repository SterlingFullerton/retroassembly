import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { setVirtualGamepadAxis, setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'
import { Thumbstick } from './thumbstick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Atari 5200's controls: an analog stick, like its own, its two red fire buttons, 1 and 2, slanted along the arc
// the thumb makes rolling from one to the other, plain Start and Pause between the hands in portrait or stacked under
// pause in landscape, and, when asked for from the top bar, its 12-key keypad, as on the ColecoVision. a5200 reads the
// stick from the left analog stick, fire 1 from A, fire 2 from B, and Start and Pause from Start and Select.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'
const fireStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #ff6a5a, #d0281c 60%, #8a140c)',
  boxShadow: '0 3px 5px #000c, inset 0 -3px 0 #0004, inset 0 2px 0 #ff9a90',
}
const fire = twMerge(pressed, 'absolute rounded-full text-[22px] font-extrabold text-[#3a0000]')
const plain = twMerge(
  pressed,
  'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
)
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

// a5200 reads 0, ✱ and # from R, Y and X, 5 from the right stick's click, and the other digits from the right stick
// pushed towards them on a phone's keypad: up and left is 1, up is 2, up and right is 3, and so on
function holdRightStick(x: number, y: number) {
  return {
    handleEnd: () => {
      setVirtualGamepadAxis(2, 0)
      setVirtualGamepadAxis(3, 0)
    },
    handleStart: () => {
      setVirtualGamepadAxis(2, x)
      setVirtualGamepadAxis(3, y)
    },
  }
}
function holdButton(index: number) {
  return {
    handleEnd: () => setVirtualGamepadButton(index, false),
    handleStart: () => setVirtualGamepadButton(index, true),
  }
}
const keypadKeys: [string, { buttonName: string } | { handleEnd: () => void; handleStart: () => void }][] = [
  ['1', holdRightStick(-1, -1)],
  ['2', holdRightStick(0, -1)],
  ['3', holdRightStick(1, -1)],
  ['4', holdRightStick(-1, 0)],
  ['5', holdButton(11)],
  ['6', holdRightStick(1, 0)],
  ['7', holdRightStick(-1, 1)],
  ['8', holdRightStick(0, 1)],
  ['9', holdRightStick(1, 1)],
  ['✱', { buttonName: 'y' }],
  ['0', { buttonName: 'r' }],
  ['#', { buttonName: 'x' }],
]

export function Atari5200Controls({
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
        <Thumbstick
          className='absolute bottom-16 left-5 size-37.5 landscape:bottom-15 landscape:left-3 landscape:size-34'
          stick='left'
        />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='a'
          className={twMerge(
            fire,
            'right-27 bottom-19 size-19.5 landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
          )}
          group='fire'
          style={fireStyle}
          title='1'
        >
          1
        </VirtualGamepadButton>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            fire,
            'right-4.5 bottom-29 size-19.5 landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
          )}
          group='fire'
          style={fireStyle}
          title='2'
        >
          2
        </VirtualGamepadButton>
      </div>

      {/* Start and Pause: side by side between the hands in portrait, stacked under pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 flex -translate-x-1/2 gap-2 landscape:top-[52px] landscape:bottom-auto landscape:left-3 landscape:translate-x-0 landscape:flex-col landscape:items-start'>
          <VirtualGamepadButton buttonName='start' className={plain} style={plainStyle} title='Start'>
            START
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='select' className={plain} style={plainStyle} title='Pause'>
            PAUSE
          </VirtualGamepadButton>
        </div>
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
