import { useId } from 'react'
import { twMerge } from 'tailwind-merge'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The d-pad every console's on-screen controls use: one solid dark cross, drawn as a single shape so it reads as one
// piece rather than two bars laid across each other. Over it lie nine invisible touch areas: the four arms, which light
// up while pressed, and the empty corners, which press two directions at once.
const arm = 'bg-transparent data-[touching=true]:bg-white/15'
const corner = 'bg-transparent data-[touching=true]:bg-transparent'

// A plus with rounded ends over a 3 by 3 grid of 60, so each arm is exactly one of the grid's cells
const cross =
  'M66 0h48a6 6 0 0 1 6 6v54h54a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6h-54v54a6 6 0 0 1-6 6h-48a6 6 0 0 1-6-6v-54h-54a6 6 0 0 1-6-6v-48a6 6 0 0 1 6-6h54v-54a6 6 0 0 1 6-6z'

/** A d-pad, sized and placed by `className` */
export function DPad({ className }: Readonly<{ className?: string }>) {
  const gradient = useId()
  return (
    <div className={twMerge('relative', className)}>
      <svg
        aria-hidden
        className='pointer-events-none absolute inset-0 size-full drop-shadow-[0_3px_3px_#000b]'
        viewBox='0 0 180 180'
      >
        <defs>
          <linearGradient id={gradient} x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0' stopColor='#46464c' />
            <stop offset='1' stopColor='#1e1e22' />
          </linearGradient>
        </defs>
        <path d={cross} fill={`url(#${gradient})`} />
        <g fill='#8a8a90' fontFamily='system-ui, sans-serif' fontSize='16' textAnchor='middle'>
          <text x='90' y='38'>
            ▲
          </text>
          <text x='90' y='156'>
            ▼
          </text>
          <text x='30' y='96'>
            ◀
          </text>
          <text x='150' y='96'>
            ▶
          </text>
        </g>
      </svg>
      <div className='absolute inset-0 grid grid-cols-3 grid-rows-3'>
        <VirtualGamepadButton buttonNames={['up', 'left']} className={corner} group='dpad' title='up,left' />
        <VirtualGamepadButton buttonName='up' className={twMerge(arm, 'rounded-t-[10%]')} group='dpad' title='up' />
        <VirtualGamepadButton buttonNames={['right', 'up']} className={corner} group='dpad' title='right,up' />
        <VirtualGamepadButton buttonName='left' className={twMerge(arm, 'rounded-l-[10%]')} group='dpad' title='left' />
        <div />
        <VirtualGamepadButton
          buttonName='right'
          className={twMerge(arm, 'rounded-r-[10%]')}
          group='dpad'
          title='right'
        />
        <VirtualGamepadButton buttonNames={['left', 'down']} className={corner} group='dpad' title='left,down' />
        <VirtualGamepadButton buttonName='down' className={twMerge(arm, 'rounded-b-[10%]')} group='dpad' title='down' />
        <VirtualGamepadButton buttonNames={['right', 'down']} className={corner} group='dpad' title='right,down' />
      </div>
    </div>
  )
}
