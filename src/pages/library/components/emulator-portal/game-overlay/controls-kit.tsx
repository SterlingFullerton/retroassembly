import { clsx } from 'clsx'
import { type PointerEvent, type ReactNode, useRef } from 'react'

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
