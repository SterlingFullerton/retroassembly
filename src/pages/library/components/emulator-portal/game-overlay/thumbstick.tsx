import { setVirtualGamepadAxis } from '#@/emulator/on-screen-gamepad.ts'
import { StickLook, useStick } from './controls-kit.tsx'

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
  const [xAxis, yAxis] = sticks[stick]
  const { handlers, knob } = useStick({
    onMove(x, y) {
      setVirtualGamepadAxis(xAxis, x)
      setVirtualGamepadAxis(yAxis, y)
    },
    onRelease() {
      setVirtualGamepadAxis(xAxis, 0)
      setVirtualGamepadAxis(yAxis, 0)
    },
    reach: (width) => width / 2 - width * 0.12,
  })

  return (
    <StickLook
      className={className}
      handlers={handlers}
      knob={knob}
      title={stick === 'left' ? 'Left stick' : 'Right stick'}
    />
  )
}
