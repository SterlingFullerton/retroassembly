import { clsx } from 'clsx'
import type { CSSProperties } from 'react'
import { twMerge } from 'tailwind-merge'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Genesis's controls drawn like its controller: a round thumb pad with a cross on it, A, B and C as big black
// buttons in a row slanting up to the right, and the 6-button pad's X, Y and Z as a smaller row above them. Start and
// Mode sit between the hands in portrait, and beside pause at the top left in landscape. Genesis Plus GX reads A, B and
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
const pressed = 'data-[touching=true]:brightness-150 data-[touching=true]:scale-95'
const face = twMerge(
  pressed,
  scaled,
  'rounded-full font-bold text-[#f2f2f2] shadow-[0_3px_5px_#000c,inset_0_1px_0_#ffffff30]',
)
const faceBackground = 'radial-gradient(circle at 38% 30%, #4a4a4e, #161618 65%, #0a0a0b)'
const arm = twMerge(pressed, 'text-[length:calc(11*var(--u))] text-[#8a8a8f]')
const armStyle: CSSProperties = { background: 'linear-gradient(#2c2c2f, #18181a)' }
const diagonal = 'bg-transparent data-[touching=true]:bg-white/10'

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
  X: placed([160, 124, 44, 15], [116, 112, 38, 14]),
  Y: placed([88, 148, 44, 15], [64, 132, 38, 14]),
  Z: placed([20, 176, 44, 15], [12, 156, 38, 14]),
}

function FaceButton({
  buttonName,
  hidden,
  label,
}: Readonly<{ buttonName: string; hidden: string; label: keyof typeof places }>) {
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
  const pill = twMerge(
    pressed,
    'h-7 rounded-full px-3.5 text-[11px] font-bold tracking-wider text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22]',
  )
  const pillStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

  return (
    <div
      className={twMerge(
        'pointer-events-none absolute inset-0 *:pointer-events-auto',
        '[--u:min(1px,calc(100vw/390))] landscape:[--u:min(1px,calc(100vh/390))]',
      )}
    >
      {/* The thumb pad: a disc with a cross of four arms; its corners press two directions at once */}
      <div
        className={twMerge(
          'absolute bottom-[calc(56*var(--u)+env(safe-area-inset-bottom))] left-[calc(16*var(--u)+env(safe-area-inset-left))] size-[calc(150*var(--u))] rounded-full shadow-[0_4px_8px_#000c,inset_0_1px_0_#ffffff22]',
          'landscape:left-[calc(12*var(--u)+env(safe-area-inset-left))] landscape:size-[calc(140*var(--u))]',
          hidden,
        )}
        style={{ background: 'radial-gradient(circle at 40% 35%, #3a3a3d, #1c1c1e 70%)' }}
      >
        <div className='absolute inset-[13%] grid grid-cols-3 grid-rows-3'>
          <VirtualGamepadButton
            buttonNames={['up', 'left']}
            className={twMerge(diagonal, 'rounded-tl-full')}
            group='dpad'
            title='up,left'
          />
          <VirtualGamepadButton
            buttonName='up'
            className={twMerge(arm, 'rounded-t-md')}
            group='dpad'
            style={armStyle}
            title='up'
          >
            ▲
          </VirtualGamepadButton>
          <VirtualGamepadButton
            buttonNames={['right', 'up']}
            className={twMerge(diagonal, 'rounded-tr-full')}
            group='dpad'
            title='right,up'
          />
          <VirtualGamepadButton
            buttonName='left'
            className={twMerge(arm, 'rounded-l-md')}
            group='dpad'
            style={armStyle}
            title='left'
          >
            ◀
          </VirtualGamepadButton>
          <div style={armStyle} />
          <VirtualGamepadButton
            buttonName='right'
            className={twMerge(arm, 'rounded-r-md')}
            group='dpad'
            style={armStyle}
            title='right'
          >
            ▶
          </VirtualGamepadButton>
          <VirtualGamepadButton
            buttonNames={['left', 'down']}
            className={twMerge(diagonal, 'rounded-bl-full')}
            group='dpad'
            title='left,down'
          />
          <VirtualGamepadButton
            buttonName='down'
            className={twMerge(arm, 'rounded-b-md')}
            group='dpad'
            style={armStyle}
            title='down'
          >
            ▼
          </VirtualGamepadButton>
          <VirtualGamepadButton
            buttonNames={['right', 'down']}
            className={twMerge(diagonal, 'rounded-br-full')}
            group='dpad'
            title='right,down'
          />
        </div>
      </div>

      {/* A, B and C, big, in their slanted row; X, Y and Z, a smaller row above, for 6-button games */}
      <FaceButton buttonName='y' hidden={hidden} label='A' />
      <FaceButton buttonName='b' hidden={hidden} label='B' />
      <FaceButton buttonName='a' hidden={hidden} label='C' />
      <FaceButton buttonName='l' hidden={hidden} label='X' />
      <FaceButton buttonName='x' hidden={hidden} label='Y' />
      <FaceButton buttonName='r' hidden={hidden} label='Z' />

      {/* Start and Mode: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'absolute bottom-[calc(248*var(--u)+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 gap-2',
          'landscape:left-safe-offset-10 landscape:top-safe-offset-1 landscape:bottom-auto landscape:translate-x-0',
          hidden,
        )}
      >
        <VirtualGamepadButton buttonName='start' className={pill} style={pillStyle}>
          START
        </VirtualGamepadButton>
        <VirtualGamepadButton buttonName='select' className={pill} style={pillStyle}>
          MODE
        </VirtualGamepadButton>
      </div>
    </div>
  )
}
