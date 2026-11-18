import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Super Famicom's controls drawn like its controller: the d-pad every console shares, A, B, X and Y in its
// diamond and colours on a grey plate, grey L and R shoulder buttons, and Select and Start in the top bar beside
// pause. Snes9x reads the RetroPad's buttons as the controller's, so each button is
// the one its letter says.
const pressed = pressedLook(90)
const dish: CSSProperties = { background: 'radial-gradient(circle at 45% 40%, #d9d9de, #b9b9c0 70%)' }
const dishShadow = 'rounded-full shadow-[inset_0_2px_6px_#0005,0_0_0_2px_#9a9aa2]'

function colored(light: string, middle: string, dark: string) {
  return `radial-gradient(circle at 40% 30%, ${light}, ${middle} 60%, ${dark})`
}

// Each face button: its colour, text colour, and place in the diamond in portrait and in landscape
const faceButtons: [label: string, buttonName: RetroPadButton, style: CSSProperties, className: string][] = [
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

export function SnesControls({ visible }: Readonly<{ visible: boolean }>) {
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
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
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
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
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select'>SELECT</TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
