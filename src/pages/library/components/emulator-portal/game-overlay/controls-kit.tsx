import { clsx } from 'clsx'
import type { ReactNode } from 'react'

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
