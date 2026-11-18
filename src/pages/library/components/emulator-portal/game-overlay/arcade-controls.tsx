import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { Corner, pressedLook } from './controls-kit.tsx'
import { Joystick } from './joystick.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// An arcade cabinet's controls: a stick, and push-buttons numbered as the game numbers them. Most arcade games
// use one or two buttons, so 1 and 2 are big and sit under the thumb; 3 to 6, for fighting games and the like, are a
// smaller group above them. Coin and Start sit in the top bar beside pause.
//
// FinalBurn Neo reads buttons 1 to 6 from the RetroPad's B, A, Y, X, R and L; in Street Fighter-like games that puts
// the punches on 3, 4 and 6 and the kicks on 1, 2 and 5.
const pressed = pressedLook(125)
const pushButton = twMerge(
  pressed,
  'absolute rounded-full font-bold shadow-[0_3px_5px_#000c,inset_0_-3px_0_#0004,inset_0_2px_0_#fff4]',
)

function colored([light, middle, dark]: [string, string, string], text: string): CSSProperties {
  return { background: `radial-gradient(circle at 40% 30%, ${light}, ${middle} 60%, ${dark})`, color: text }
}

// Each button: its RetroPad button, its colour, and its place in portrait and in landscape
const buttons: [label: string, buttonName: RetroPadButton, style: CSSProperties, className: string][] = [
  [
    '1',
    'b',
    colored(['#ff7a7a', '#d42222', '#941414'], '#3a0000'),
    'right-25 bottom-16 size-18.5 text-2xl landscape:right-21.5 landscape:bottom-15 landscape:size-15 landscape:text-xl',
  ],
  [
    '2',
    'a',
    colored(['#fff19a', '#f1c40f', '#a88405'], '#3a2a00'),
    'right-4 bottom-24 size-18.5 text-2xl landscape:right-3.5 landscape:bottom-21 landscape:size-15 landscape:text-xl',
  ],
  [
    '3',
    'y',
    colored(['#8ac6ff', '#2a7fd4', '#154f8a'], '#001a33'),
    'right-41 bottom-49 size-10.5 text-sm landscape:right-21.5 landscape:bottom-43 landscape:size-9.5',
  ],
  [
    '4',
    'x',
    colored(['#9af0a6', '#2fb84a', '#1a7a2c'], '#00300a'),
    'right-28.5 bottom-47.5 size-10.5 text-sm landscape:right-10 landscape:bottom-43 landscape:size-9.5',
  ],
  [
    '5',
    'r',
    colored(['#ffffff', '#d6d6dc', '#8f8f96'], '#222'),
    'right-16 bottom-46 size-10.5 text-sm landscape:right-21.5 landscape:bottom-54.5 landscape:size-9.5',
  ],
  [
    '6',
    'l',
    colored(['#5a5a60', '#222226', '#0c0c0e'], '#ddd'),
    'right-3.5 bottom-44.5 size-10.5 text-sm landscape:right-10 landscape:bottom-54.5 landscape:size-9.5',
  ],
]

export function ArcadeControls({ visible }: Readonly<{ visible: boolean }>) {
  const { t } = useTranslation()
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)

  return (
    <>
      <Corner scale={scale} side='left' visible={visible}>
        <div className='absolute bottom-15 left-4.5 size-37.5 landscape:bottom-16.5 landscape:left-2.5 landscape:size-34'>
          <Joystick />
        </div>
      </Corner>

      <Corner scale={scale} side='right' visible={visible}>
        {buttons.map(([label, buttonName, style, className]) => (
          <VirtualGamepadButton
            buttonName={buttonName}
            className={twMerge(pushButton, className)}
            group='buttons'
            key={label}
            style={style}
            title={`Button ${label}`}
          >
            {label}
          </VirtualGamepadButton>
        ))}
      </Corner>

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select' className='uppercase' title={t('emulator.coin')}>
          {t('emulator.coin')}
        </TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
    </>
  )
}
