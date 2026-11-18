import { setVirtualGamepadButton } from '#@/emulator/on-screen-gamepad.ts'
import { StickLook, useStick } from './controls-kit.tsx'

// The joystick's directions, as the gamepad's d-pad buttons
const directionButtons = { down: 13, left: 14, right: 15, up: 12 }

function setDirections(directions: Partial<Record<keyof typeof directionButtons, boolean>>) {
  for (const [direction, index] of Object.entries(directionButtons)) {
    setVirtualGamepadButton(index, Boolean(directions[direction as keyof typeof directionButtons]))
  }
}

/**
 * A digital joystick, as on a controller or cabinet: it leans towards the thumb and presses the nearest of eight
 * directions, as the on-screen gamepad's d-pad, so the emulator must have it attached
 */
export function Joystick() {
  const { handlers, knob } = useStick({
    // Near the middle nothing is pressed; elsewhere, each eighth of the circle presses its one or two directions
    onMove(x, y, distance) {
      if (distance < 0.3) {
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
    },
    onRelease: () => setDirections({}),
    reach: (width) => width / 2 - 16,
  })

  return <StickLook className='size-full' handlers={handlers} knob={knob} title='Joystick' />
}
