import { type PointerEvent, useRef } from 'react'
import { setVirtualGamepadButton } from '#@/pages/library/utils/virtual-gamepad.ts'

// The joystick's directions, as the gamepad's d-pad buttons
const directionButtons = { down: 13, left: 14, right: 15, up: 12 }

function setDirections(directions: Partial<Record<keyof typeof directionButtons, boolean>>) {
  for (const [direction, index] of Object.entries(directionButtons)) {
    setVirtualGamepadButton(index, Boolean(directions[direction as keyof typeof directionButtons]))
  }
}

const knobs = {
  // The arcade's red ball on a short shaft
  ball: { background: 'radial-gradient(circle at 35% 30%, #ff8a8a, #e01e1e 55%, #8a0c0c)' },
  // The ColecoVision's ridged black knob
  ridged: { background: 'repeating-conic-gradient(#2f2f31 0 10deg, #1d1d1f 10deg 20deg)' },
}

/**
 * A digital joystick, as on a controller or cabinet: it leans towards the thumb and presses the nearest of eight
 * directions, as the on-screen gamepad's d-pad, so the emulator must have it attached
 */
export function Joystick({ knob: knobName = 'ridged' }: Readonly<{ knob?: keyof typeof knobs }>) {
  const knob = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | undefined>(undefined)

  function move(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const reach = rect.width / 2 - 16
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
    // Near the middle nothing is pressed; elsewhere, each eighth of the circle presses its one or two directions
    if (distance < reach * 0.3) {
      setDirections({})
      return
    }
    const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4))
    setDirections({
      down: sector >= 1 && sector <= 3,
      left: Math.abs(sector) >= 3,
      right: Math.abs(sector) <= 1,
      up: sector <= -1 && sector >= -3,
    })
  }

  function handleRelease() {
    activePointer.current = undefined
    if (knob.current) {
      knob.current.style.transform = ''
    }
    setDirections({})
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
      className='flex size-full touch-none items-center justify-center rounded-full shadow-[inset_0_2px_6px_#000,0_0_0_2px_#333]'
      onPointerCancel={handleRelease}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleRelease}
      style={{ background: 'radial-gradient(circle, #2a2a2c 55%, #1a1a1b 56%, #222 70%, #111)' }}
      title='Joystick'
    >
      <div
        className='pointer-events-none size-[45%] rounded-full shadow-[0_4px_8px_#000c,inset_0_1px_0_#ffffff30]'
        ref={knob}
        style={knobs[knobName]}
      />
    </div>
  )
}
