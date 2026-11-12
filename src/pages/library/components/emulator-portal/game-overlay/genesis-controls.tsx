import { clsx } from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Genesis's controls drawn like its controller: a round thumb pad with a cross on it, A, B and C as big black
// buttons in a row slanting up to the right, and the 6-button pad's X, Y and Z as a smaller row above them. Start and
// Mode sit between the hands in portrait, and beside pause at the top left in landscape. Genesis Plus GX reads A, B and
// C from the RetroPad's Y, B and A, X, Y and Z from L, X and R, and Mode from Select.
const pressed = 'data-[touching=true]:brightness-150 data-[touching=true]:scale-95'
const faceStyle: CSSProperties = {
  background: 'radial-gradient(circle at 38% 30%, #4a4a4e, #161618 65%, #0a0a0b)',
}
const face = twMerge(
  pressed,
  'absolute rounded-full font-bold text-[#f2f2f2] shadow-[0_3px_5px_#000c,inset_0_1px_0_#ffffff30]',
)
const arm = twMerge(pressed, 'text-[11px] text-[#8a8a8f]')
const armStyle: CSSProperties = { background: 'linear-gradient(#2c2c2f, #18181a)' }
const diagonal = 'bg-transparent data-[touching=true]:bg-white/10'

function FaceButton({
  buttonName,
  children,
  className,
}: Readonly<{ buttonName: string; children: ReactNode; className: string }>) {
  return (
    <VirtualGamepadButton buttonName={buttonName} className={twMerge(face, className)} group='face' style={faceStyle}>
      {children}
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
    <>
      {/* The thumb pad: a disc with a cross of four arms; its corners press two directions at once */}
      <div
        className={twMerge(
          'bottom-safe-offset-14 left-safe-offset-4 absolute size-37.5 rounded-full shadow-[0_4px_8px_#000c,inset_0_1px_0_#ffffff22]',
          'landscape:bottom-safe-offset-14 landscape:left-safe-offset-3 landscape:size-35',
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

      {/* A, B and C, big, in their slanted row */}
      <FaceButton
        buttonName='y'
        className={twMerge(
          'right-safe-offset-38 bottom-safe-offset-10 size-15.5 text-[21px]',
          'landscape:right-safe-offset-27 landscape:bottom-safe-offset-10 landscape:size-13 landscape:text-lg',
          hidden,
        )}
      >
        A
      </FaceButton>
      <FaceButton
        buttonName='b'
        className={twMerge(
          'right-safe-offset-20 bottom-safe-offset-17 size-15.5 text-[21px]',
          'landscape:right-safe-offset-14 landscape:bottom-safe-offset-16 landscape:size-13 landscape:text-lg',
          hidden,
        )}
      >
        B
      </FaceButton>
      <FaceButton
        buttonName='a'
        className={twMerge(
          'right-safe-offset-3 bottom-safe-offset-24 size-15.5 text-[21px]',
          'landscape:right-safe-offset-1 landscape:bottom-safe-offset-21 landscape:size-13 landscape:text-lg',
          hidden,
        )}
      >
        C
      </FaceButton>

      {/* X, Y and Z, a smaller row above, for the games made for the 6-button pad */}
      <FaceButton
        buttonName='l'
        className={twMerge(
          'right-safe-offset-40 bottom-safe-offset-31 size-11 text-[15px]',
          'landscape:right-safe-offset-29 landscape:bottom-safe-offset-28 landscape:size-9.5 landscape:text-sm',
          hidden,
        )}
      >
        X
      </FaceButton>
      <FaceButton
        buttonName='x'
        className={twMerge(
          'right-safe-offset-22 bottom-safe-offset-37 size-11 text-[15px]',
          'landscape:right-safe-offset-16 landscape:bottom-safe-offset-33 landscape:size-9.5 landscape:text-sm',
          hidden,
        )}
      >
        Y
      </FaceButton>
      <FaceButton
        buttonName='r'
        className={twMerge(
          'right-safe-offset-5 bottom-safe-offset-44 size-11 text-[15px]',
          'landscape:right-safe-offset-3 landscape:bottom-safe-offset-39 landscape:size-9.5 landscape:text-sm',
          hidden,
        )}
      >
        Z
      </FaceButton>

      {/* Start and Mode: between the hands in portrait, beside pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe-offset-62 absolute left-1/2 flex -translate-x-1/2 gap-2',
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
    </>
  )
}
