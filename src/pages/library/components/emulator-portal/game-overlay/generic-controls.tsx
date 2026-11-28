import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The controls of a console or emulator with no controller of its own drawn: a RetroPad, with L1 and L2 over the d-pad,
// R2 and R1 over the face buttons, and Select and Start in the top bar beside pause. Select inserts a coin on an arcade

// X, Y, A and B around a diamond, by their grid cells
const faceButtons: [RetroPadButton & ('a' | 'b' | 'x' | 'y'), string][] = [
  ['x', 'col-start-2 row-start-1'],
  ['y', 'col-start-1 row-start-2'],
  ['a', 'col-start-3 row-start-2'],
  ['b', 'col-start-2 row-start-3'],
]

export function GenericControls({ coin = false, visible }: Readonly<{ coin?: boolean; visible: boolean }>) {
  const { t } = useTranslation()
  return (
    <>
      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='select' className={clsx({ uppercase: coin })}>
          {coin ? t('emulator.coin') : 'SELECT'}
        </TopBarButton>
        <TopBarButton buttonName='start'>START</TopBarButton>
      </TopBarButtons>
      <div className={twMerge('bottom-safe left-safe absolute flex flex-col gap-2 p-2', clsx({ hidden: !visible }))}>
        <div className='flex w-full gap-2'>
          <VirtualGamepadButton buttonName='l' className='h-11 flex-1 rounded px-2 ring ring-white/20'>
            L1
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='l2' className='h-11 flex-1 rounded px-2 ring ring-white/20'>
            L2
          </VirtualGamepadButton>
        </div>
        <DPad className='tablet:size-50 size-42' />
      </div>

      <div className={twMerge('bottom-safe right-safe absolute flex flex-col gap-2 p-2', clsx({ hidden: !visible }))}>
        <div className='flex w-full gap-2'>
          <VirtualGamepadButton buttonName='r2' className='h-11 flex-1 rounded px-2 ring ring-white/20'>
            R2
          </VirtualGamepadButton>
          <VirtualGamepadButton buttonName='r' className='h-11 flex-1 rounded px-2 ring ring-white/20'>
            R1
          </VirtualGamepadButton>
        </div>
        <div className='tablet:text-lg tablet:*:size-16.5 grid grid-cols-3 grid-rows-3 *:size-14 *:rounded-full'>
          {faceButtons.map(([button, position]) => (
            <VirtualGamepadButton
              buttonName={button}
              className={twMerge(position, 'ring ring-white/20')}
              group='face'
              key={button}
            >
              {button.toUpperCase()}
            </VirtualGamepadButton>
          ))}
        </div>
      </div>
    </>
  )
}
