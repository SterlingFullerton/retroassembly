import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Super Famicom's controls drawn like its controller: the d-pad every console shares, A, B, X and Y in its
// diamond and colours on a grey plate, grey L and R shoulder buttons, and slanted Select and Start between the hands in
// portrait, or beside pause in landscape. Snes9x reads the RetroPad's buttons as the controller's, so each button is
// the one its letter says.
const pressed = 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95'
const dish: CSSProperties = { background: 'radial-gradient(circle at 45% 40%, #d9d9de, #b9b9c0 70%)' }
const dishShadow = 'rounded-full shadow-[inset_0_2px_6px_#0005,0_0_0_2px_#9a9aa2]'

function colored(light: string, middle: string, dark: string) {
  return `radial-gradient(circle at 40% 30%, ${light}, ${middle} 60%, ${dark})`
}

// Each face button: its colour, text colour, and place in the diamond in portrait and in landscape
const faceButtons: [label: string, buttonName: string, style: CSSProperties, className: string][] = [
  [
    'X',
    'x',
    { background: colored('#8fb8ff', '#2f66d8', '#17408f'), color: '#fff' },
    'right-[75px] bottom-[168px] landscape:right-[61px] landscape:bottom-[154px]',
  ],
  [
    'Y',
    'y',
    { background: colored('#9be8a0', '#2a9a46', '#156328'), color: '#fff' },
    'right-[130px] bottom-[113px] landscape:right-[106px] landscape:bottom-[109px]',
  ],
  [
    'A',
    'a',
    { background: colored('#ff7b7b', '#d8262c', '#9a1218'), color: '#fff' },
    'right-[20px] bottom-[113px] landscape:right-[16px] landscape:bottom-[109px]',
  ],
  [
    'B',
    'b',
    { background: colored('#ffe680', '#f0bf12', '#a88405'), color: '#4a3800' },
    'right-[75px] bottom-[58px] landscape:right-[61px] landscape:bottom-[64px]',
  ],
]

const shoulder = twMerge(
  pressed,
  'absolute bottom-[262px] h-7.5 w-27.5 rounded-t-[15px] rounded-b-lg text-sm font-extrabold text-[#3a3a3e] shadow-[0_2px_4px_#0008,inset_0_1px_0_#fff]',
  'landscape:bottom-[222px] landscape:w-28',
)
const shoulderStyle: CSSProperties = { background: 'linear-gradient(#e2e2e6, #a8a8b0)' }

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
        style={{ background: 'linear-gradient(#4a4a50, #26262a)' }}
      />
      <span className='text-[9px] font-bold tracking-widest text-[#9a9aa2]'>{label}</span>
    </VirtualGamepadButton>
  )
}

export function SnesControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)

  return (
    <>
      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(shoulder, 'left-4 landscape:left-5.5')}
          style={shoulderStyle}
          title='L'
        >
          L
        </VirtualGamepadButton>
        {/* The d-pad */}
        <DPad className='absolute bottom-16 left-4 size-40 landscape:bottom-15 landscape:left-2.5 landscape:size-35' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(shoulder, 'right-4 landscape:right-5.5')}
          style={shoulderStyle}
          title='R'
        >
          R
        </VirtualGamepadButton>
        <div
          className={twMerge(
            'absolute right-3.5 bottom-13 size-44 landscape:right-2 landscape:bottom-14 landscape:size-37.5',
            dishShadow,
          )}
          style={dish}
        />
        {faceButtons.map(([label, buttonName, style, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(
              pressed,
              'absolute size-13.5 rounded-full text-xl font-extrabold shadow-[0_3px_4px_#0008,inset_0_2px_0_#fff5,inset_0_-3px_0_#0003] landscape:size-11 landscape:text-base',
              className,
            )}
            group='face'
            key={label}
            style={style}
            title={label}
          >
            {label}
          </VirtualGamepadButton>
        ))}
      </div>

      {/* Select and Start: between the shoulders in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe-offset-11 absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[252px] left-0 flex -translate-x-1/2 gap-1.5 landscape:top-2 landscape:bottom-auto landscape:left-0 landscape:translate-x-0'>
          <Pill buttonName='select' label='SELECT' />
          <Pill buttonName='start' label='START' />
        </div>
      </div>
    </>
  )
}
