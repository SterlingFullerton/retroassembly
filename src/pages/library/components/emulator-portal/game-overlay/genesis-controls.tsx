import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { pressedLook } from './controls-kit.tsx'
import { DPad } from './dpad.tsx'
import { TopBarButton, TopBarButtons } from './top-bar-buttons.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Genesis's controls drawn like its controller: the d-pad every console shares, A, B and C as big black
// buttons in a row slanting up to the right, and the 6-button pad's X, Y and Z as a smaller row above them. Start and
// Mode sit in the top bar beside pause. Genesis Plus GX reads A, B and
// C from the RetroPad's Y, B and A, X, Y and Z from L, X and R, and Mode from Select.
//
// Sizes and places are in a unit, --u, that is a point on a phone 390 points wide (or, in landscape, 390 high) and
// shrinks on smaller screens, so the layout keeps its shape instead of the buttons running into the thumb pad.
// Each button gives its numbers in custom properties: --pr, --pb, --ps and --pf for its right, bottom, size and text
// size in portrait, and --lr, --lb, --ls and --lf in landscape.
const scaled = twMerge(
  'absolute right-[calc(var(--pr)*var(--u)+env(safe-area-inset-right))] bottom-[calc(var(--pb)*var(--u)+env(safe-area-inset-bottom))] size-[calc(var(--ps)*var(--u))] text-[length:calc(var(--pf)*var(--u))]',
  'landscape:right-[calc(var(--lr)*var(--u)+env(safe-area-inset-right))] landscape:bottom-[calc(var(--lb)*var(--u)+env(safe-area-inset-bottom))] landscape:size-[calc(var(--ls)*var(--u))] landscape:text-[length:calc(var(--lf)*var(--u))]',
)
const pressed = pressedLook(150)
const face = twMerge(
  pressed,
  scaled,
  'rounded-full font-bold text-[#f2f2f2] shadow-[0_3px_5px_#000c,inset_0_1px_0_#ffffff30]',
)
const faceBackground = 'radial-gradient(circle at 38% 30%, #4a4a4e, #161618 65%, #0a0a0b)'

// [right, bottom, size, text size] in portrait, then in landscape
type Place = [number, number, number, number]
function placed([pr, pb, ps, pf]: Place, [lr, lb, ls, lf]: Place) {
  return {
    '--lb': lb,
    '--lf': lf,
    '--lr': lr,
    '--ls': ls,
    '--pb': pb,
    '--pf': pf,
    '--pr': pr,
    '--ps': ps,
  } as CSSProperties
}

const places = {
  A: placed([152, 40, 62, 21], [108, 40, 52, 18]),
  B: placed([80, 68, 62, 21], [56, 64, 52, 18]),
  C: placed([12, 96, 62, 21], [4, 84, 52, 18]),
  X: placed([160, 124, 44, 15], [112, 112, 44, 15]),
  Y: placed([88, 148, 44, 15], [60, 134, 44, 15]),
  Z: placed([20, 176, 44, 15], [8, 158, 44, 15]),
}

function FaceButton({
  buttonName,
  hidden,
  label,
}: Readonly<{ buttonName: RetroPadButton; hidden: string; label: keyof typeof places }>) {
  return (
    <VirtualGamepadButton
      buttonName={buttonName}
      className={twMerge(face, hidden)}
      group='face'
      style={{ ...places[label], background: faceBackground }}
    >
      {label}
    </VirtualGamepadButton>
  )
}

export function GenesisControls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Everything is placed and sized in this unit: a point at full size, less on a small screen and more on a tablet, as
  // for every other console. Each side's controls are about 164 points wide
  const scale = useControlsScale()

  return (
    <div
      className='pointer-events-none absolute inset-0 *:pointer-events-auto'
      style={{ '--u': `${scale}px` } as CSSProperties}
    >
      {/* The thumb pad */}
      <DPad
        className={twMerge(
          'absolute bottom-[calc(56*var(--u)+env(safe-area-inset-bottom))] left-[calc(16*var(--u)+env(safe-area-inset-left))] size-[calc(150*var(--u))]',
          'landscape:left-[calc(12*var(--u)+env(safe-area-inset-left))] landscape:size-[calc(140*var(--u))]',
          hidden,
        )}
      />

      {/* A, B and C, big, in their slanted row; X, Y and Z, a smaller row above, for 6-button games */}
      <FaceButton buttonName='y' hidden={hidden} label='A' />
      <FaceButton buttonName='b' hidden={hidden} label='B' />
      <FaceButton buttonName='a' hidden={hidden} label='C' />
      <FaceButton buttonName='l' hidden={hidden} label='X' />
      <FaceButton buttonName='x' hidden={hidden} label='Y' />
      <FaceButton buttonName='r' hidden={hidden} label='Z' />

      <TopBarButtons visible={visible}>
        <TopBarButton buttonName='start'>START</TopBarButton>
        <TopBarButton buttonName='select' title='Mode'>
          MODE
        </TopBarButton>
      </TopBarButtons>
    </div>
  )
}
