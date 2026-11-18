import { clsx } from 'clsx'
import { type CSSProperties, type PointerEvent, type ReactNode, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import type { RetroPadButton } from '#@/input/retropad.ts'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// Shared pieces of the consoles' on-screen controls. Each console keeps its own sizes, places and colours; these are
// only the parts they all draw the same way

// How a button looks while it's held: brighter or darker by the given amount, and a little smaller. Light buttons
// darken and dark ones brighten, so each console picks the amount that shows on its own buttons
const pressedLooks = {
  75: 'data-[touching=true]:brightness-75 data-[touching=true]:scale-95',
  90: 'data-[touching=true]:brightness-90 data-[touching=true]:scale-95',
  110: 'data-[touching=true]:brightness-110 data-[touching=true]:scale-95',
  125: 'data-[touching=true]:brightness-125 data-[touching=true]:scale-95',
  150: 'data-[touching=true]:brightness-150 data-[touching=true]:scale-95',
}

export function pressedLook(brightness: keyof typeof pressedLooks) {
  return pressedLooks[brightness]
}

const corners = {
  left: 'bottom-safe left-safe absolute size-0 origin-top-left',
  right: 'bottom-safe right-safe absolute size-0 origin-top-left',
}

/**
 * A group of controls in a bottom corner of the screen. It hangs off a point with no size at that corner and is scaled
 * from there (see useControlsScale), so on a smaller screen it shrinks towards its corner
 */
export function Corner({
  children,
  scale,
  side,
  visible,
}: Readonly<{ children: ReactNode; scale: number; side: keyof typeof corners; visible: boolean }>) {
  return (
    <div className={clsx(corners[side], { hidden: !visible })} style={{ scale }}>
      {children}
    </div>
  )
}

/**
 * Follows a thumb on a stick: the knob moves with the thumb, as far as `reach` (in points, from the stick's width)
 * allows, and `onMove` hears where it is, from -1 to 1 each way with down and right positive, and how far from the
 * middle as a share of the reach. `onRelease` hears when the thumb lifts. Spread `handlers` on the stick and put
 * `knob` on its knob
 */
export function useStick({
  onMove,
  onRelease,
  reach: getReach,
}: Readonly<{
  onMove: (x: number, y: number, distance: number) => void
  onRelease: () => void
  reach: (width: number) => number
}>) {
  const knob = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | undefined>(undefined)

  function move(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const reach = getReach(rect.width)
    let x = event.clientX - (rect.left + rect.width / 2)
    let y = event.clientY - (rect.top + rect.height / 2)
    const distance = Math.hypot(x, y)
    if (distance > reach) {
      x = (x / distance) * reach
      y = (y / distance) * reach
    }
    if (knob.current) {
      knob.current.style.transform = `translate(${x}px, ${y}px)`
    }
    onMove(x / reach, y / reach, distance / reach)
  }

  function handleRelease() {
    activePointer.current = undefined
    if (knob.current) {
      knob.current.style.transform = ''
    }
    onRelease()
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointer.current = event.pointerId
    move(event)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === activePointer.current) {
      move(event)
    }
  }

  return {
    handlers: {
      onPointerCancel: handleRelease,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handleRelease,
    },
    knob,
  }
}

// Where the two buttons of a slanted pair go in the right-hand corner: the first low and to the left, the second higher
// and to the right, along the arc the thumb makes rolling from one to the other. Consoles whose picture is wide, the Lynx
// and WonderSwan, have smaller buttons in landscape, closer to the edge
const pairSpots = {
  narrow: [
    'right-27 bottom-19 size-19.5 text-2xl landscape:right-15 landscape:bottom-15.5 landscape:size-12 landscape:text-lg',
    'right-4.5 bottom-29 size-19.5 text-2xl landscape:right-2 landscape:bottom-22.5 landscape:size-12 landscape:text-lg',
  ],
  standard: [
    'right-27 bottom-19 size-19.5 landscape:right-21 landscape:bottom-17.5 landscape:size-15.5',
    'right-4.5 bottom-29 size-19.5 landscape:right-3.5 landscape:bottom-26 landscape:size-15.5',
  ],
}
// Where a pair's letters or numbers go when they're printed beside the buttons rather than on them: below and to the
// right of each, as on the Game Boy
const printedSpots = [
  'right-35 bottom-12.5 landscape:right-27 landscape:bottom-11.5',
  'right-12.5 bottom-22.5 landscape:right-9.5 landscape:bottom-20',
]

interface PairButton {
  buttonName: RetroPadButton
  label: string
  title?: string
}

/**
 * A console's two main buttons as a slanted pair, in the right-hand corner (inside a `Corner`). Each console gives the
 * buttons' look; the label goes on the button, or, given `printed` (its colour), beside it as on the console
 */
export function SlantedPair({
  buttons,
  className,
  group = 'face',
  printed,
  spots = 'standard',
  style,
}: Readonly<{
  buttons: [PairButton, PairButton]
  className: string
  group?: string
  printed?: string
  spots?: keyof typeof pairSpots
  style: CSSProperties
}>) {
  return (
    <>
      {buttons.map(({ buttonName, label, title }, index) => (
        <VirtualGamepadButton
          buttonName={buttonName}
          className={twMerge(className, pairSpots[spots][index])}
          group={group}
          key={buttonName}
          style={style}
          title={title ?? label}
        >
          {printed ? undefined : label}
        </VirtualGamepadButton>
      ))}
      {printed
        ? buttons.map(({ buttonName, label }, index) => (
            <span
              className={twMerge('absolute text-lg font-black landscape:text-base', printedSpots[index])}
              key={buttonName}
              style={{ color: printed }}
            >
              {label}
            </span>
          ))
        : null}
    </>
  )
}
