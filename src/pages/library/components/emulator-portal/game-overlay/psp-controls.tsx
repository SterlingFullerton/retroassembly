import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { DPad } from './dpad.tsx'
import { pressed } from './psx-controls.tsx'
import { Thumbstick } from './thumbstick.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The PSP's controls, drawn like the PSP itself: the d-pad every console shares with the analog nub below it, and the
// four face buttons in their diamond, black and slightly glossy with thin symbols in the PlayStation's colours. L and R
// are square shoulder buttons in the same black above them, rounded at the outer corner as on the PSP. Select and Start
// sit in the top bar beside pause, in its style, so they stay out of the way. PPSSPP reads the buttons as PCSX ReARMed
// does, and the nub from the left stick

// Each symbol, drawn as a shape so all four come out the same size and weight
const symbols = {
  circle: <circle cx='12' cy='12' fill='none' r='8.5' stroke='currentColor' strokeWidth='2.6' />,
  cross: (
    <path d='M4.5 4.5 19.5 19.5M19.5 4.5 4.5 19.5' stroke='currentColor' strokeLinecap='round' strokeWidth='2.6' />
  ),
  square: <rect fill='none' height='16' rx='1.5' stroke='currentColor' strokeWidth='2.6' width='16' x='4' y='4' />,
  triangle: <path d='M12 3.5 21 19.5H3Z' fill='none' stroke='currentColor' strokeLinejoin='round' strokeWidth='2.6' />,
}

// Each face button: its name, symbol and colour, and its place in the diamond in portrait and in landscape
const faceButtons: [
  label: string,
  buttonName: RetroPadButton,
  symbol: keyof typeof symbols,
  color: string,
  className: string,
][] = [
  [
    'Triangle',
    'x',
    'triangle',
    '#3fcf8e',
    'right-[64px] bottom-[307px] landscape:right-[48px] landscape:bottom-[251px]',
  ],
  ['Square', 'y', 'square', '#e88ac8', 'right-[112px] bottom-[259px] landscape:right-[86px] landscape:bottom-[213px]'],
  ['Circle', 'a', 'circle', '#ff5a5a', 'right-[16px] bottom-[259px] landscape:right-[10px] landscape:bottom-[213px]'],
  ['Cross', 'b', 'cross', '#7aa8ff', 'right-[64px] bottom-[211px] landscape:right-[48px] landscape:bottom-[175px]'],
]

const black: CSSProperties = {
  background: 'radial-gradient(circle at 38% 30%, #3c3c42, #1d1d21 62%, #0f0f12)',
  boxShadow: '0 2px 3px #000c, inset 0 1px 0 #ffffff26',
}

// L and R: as wide as the d-pad, above the d-pad and the face buttons
const shoulder = twMerge(
  pressed,
  'absolute bottom-[366px] grid h-12 w-34 place-items-center text-sm font-extrabold text-[#c8c8ce]',
  'landscape:bottom-[296px] landscape:h-10 landscape:w-27.5 landscape:text-xs',
)

// The top bar with pause, Select and Start, drawn over the top of the game's picture
const topBarHeight = 44

export function PspControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 150 points wide, and 450 tall in portrait; they shrink on smaller screens. Sideways the
  // game fills the screen's height, under the top bar, and the controls sit over its edges: they keep the size they had
  // when the game was kept below the bar, rather than shrinking to stay clear of it
  const scale = useControlsScale(150, 480 / 272, 450, topBarHeight)
  // In landscape each side is centred in the height below the top bar; its tallest part, L or R, tops out at 336 points
  const side = { '--controls-height': `${336 * scale}px`, scale } as CSSProperties

  return (
    <>
      <div
        className={twMerge('bottom-safe left-safe controls-centred absolute size-0 origin-top-left', hidden)}
        style={side}
      >
        <VirtualGamepadButton
          buttonName='l'
          className={twMerge(shoulder, 'left-5 rounded-tl-2xl rounded-tr-md rounded-b-md landscape:left-4')}
          style={black}
        >
          L
        </VirtualGamepadButton>
        <DPad className='absolute bottom-[214px] left-5 size-34 landscape:bottom-[176px] landscape:left-4 landscape:size-27.5' />
        <Thumbstick
          className='absolute bottom-17 left-16 size-30 landscape:bottom-14 landscape:left-10 landscape:size-26'
          stick='left'
        />
      </div>

      <div
        className={twMerge('bottom-safe right-safe controls-centred absolute size-0 origin-top-left', hidden)}
        style={side}
      >
        <VirtualGamepadButton
          buttonName='r'
          className={twMerge(shoulder, 'right-4 rounded-tl-md rounded-tr-2xl rounded-b-md landscape:right-3')}
          style={black}
        >
          R
        </VirtualGamepadButton>
        {faceButtons.map(([label, buttonName, symbol, color, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(
              pressed,
              'absolute grid size-11.5 place-items-center rounded-full landscape:size-9',
              className,
            )}
            group='face'
            key={label}
            style={{ ...black, color }}
            title={label}
          >
            <svg aria-hidden className='size-5 landscape:size-4' viewBox='0 0 24 24'>
              {symbols[symbol]}
            </svg>
          </VirtualGamepadButton>
        ))}
      </div>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
