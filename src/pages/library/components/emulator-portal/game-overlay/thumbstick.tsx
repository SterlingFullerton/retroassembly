import { type PointerEvent, useRef } from 'react'
import { twMerge } from 'tailwind-merge'
import { setVirtualGamepadAxis } from '#@/pages/library/utils/virtual-gamepad.ts'

const sticks = {
  // The gamepad's axes 0 and 1
  left: [0, 1],
  // Its axes 2 and 3
  right: [2, 3],
}

/**
 * A round analog thumbstick, as on a DualShock: it tilts the on-screen gamepad's left or right stick by however far the
 * thumb pushes it, so the emulator must have the on-screen gamepad attached
 */
export function Thumbstick({ className, stick }: Readonly<{ className?: string; stick: keyof typeof sticks }>) {
  const knob = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | undefined>(undefined)
  const [xAxis, yAxis] = sticks[stick]

  function move(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const reach = rect.width / 2 - rect.width * 0.12
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
    setVirtualGamepadAxis(xAxis, x / reach)
    setVirtualGamepadAxis(yAxis, y / reach)
  }

  function handleRelease() {
    activePointer.current = undefined
    if (knob.current) {
      knob.current.style.transform = ''
    }
    setVirtualGamepadAxis(xAxis, 0)
    setVirtualGamepadAxis(yAxis, 0)
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

  return (
    <div
      className={twMerge(
        'flex touch-none items-center justify-center rounded-full shadow-[inset_0_2px_6px_#000,0_0_0_2px_#333]',
        className,
      )}
      onPointerCancel={handleRelease}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleRelease}
      style={{ background: 'radial-gradient(circle, #1b1b1d 55%, #0d0d0e 56%, #19191b 70%, #0a0a0a)' }}
      title={stick === 'left' ? 'Left stick' : 'Right stick'}
    >
      <div
        className='pointer-events-none size-[52%] rounded-full shadow-[0_3px_6px_#000c,inset_0_1px_0_#ffffff22]'
        ref={knob}
        style={{ background: 'radial-gradient(circle at 40% 35%, #3a3a3e, #1a1a1c 70%)' }}
      />
    </div>
  )
}
