import { useId } from 'react'
import { twMerge } from 'tailwind-merge'
import { setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The d-pad every console's on-screen controls use: one solid dark cross, drawn as a single shape so it reads as one
// piece rather than two bars laid across each other. Over it lie nine invisible touch areas: the four arms, which light
// up while pressed, and the empty corners, which press two directions at once.
const arm = 'bg-transparent data-[touching=true]:bg-white/15'
const corner = 'bg-transparent data-[touching=true]:bg-transparent'

// A plus with rounded ends over a 3 by 3 grid of 60, so each arm is exactly one of the grid's cells
const cross =
  'M66 0h48a6 6 0 0 1 6 6v54h54a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6h-54v54a6 6 0 0 1-6 6h-48a6 6 0 0 1-6-6v-54h-54a6 6 0 0 1-6-6v-48a6 6 0 0 1 6-6h54v-54a6 6 0 0 1 6-6z'

type Direction = 'down' | 'left' | 'right' | 'up'

// What touching each of the nine areas presses, by its title
const areas: Direction[][] = [
  ['up', 'left'],
  ['up'],
  ['right', 'up'],
  ['left'],
  [],
  ['right'],
  ['left', 'down'],
  ['down'],
  ['right', 'down'],
]
const armRounding: Record<Direction, string> = {
  down: 'rounded-b-[10%]',
  left: 'rounded-l-[10%]',
  right: 'rounded-r-[10%]',
  up: 'rounded-t-[10%]',
}

function pressGamepadButtons(buttons: Record<Direction, number>, directions: Direction[], pressed: boolean) {
  for (const direction of directions) {
    setVirtualGamepadButton(buttons[direction], pressed)
  }
}

/**
 * A d-pad, sized and placed by `className`. It presses the RetroPad's d-pad, or, given `gamepadButtons`, the on-screen
 * gamepad's buttons at those standard indices instead, for a second d-pad such as the Virtual Boy's right one. Each
 * d-pad on screen takes its own `group`, so a finger can't slide from one onto the other.
 */
export function DPad({
  className,
  gamepadButtons,
  group = 'dpad',
}: Readonly<{ className?: string; gamepadButtons?: Record<Direction, number>; group?: string }>) {
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
        {areas.map((directions) => {
          if (directions.length === 0) {
            return <div key='middle' />
          }
          const title = directions.join(',')
          const className = directions.length === 1 ? twMerge(arm, armRounding[directions[0]]) : corner
          if (!gamepadButtons) {
            return directions.length === 1 ? (
              <VirtualGamepadButton buttonName={title} className={className} group={group} key={title} title={title} />
            ) : (
              <VirtualGamepadButton
                buttonNames={directions}
                className={className}
                group={group}
                key={title}
                title={title}
              />
            )
          }
          return (
            <VirtualGamepadButton
              className={className}
              group={group}
              key={title}
              onVirtualPressEnd={() => pressGamepadButtons(gamepadButtons, directions, false)}
              onVirtualPressStart={() => pressGamepadButtons(gamepadButtons, directions, true)}
              title={title}
            />
          )
        })}
      </div>
    </div>
  )
}
