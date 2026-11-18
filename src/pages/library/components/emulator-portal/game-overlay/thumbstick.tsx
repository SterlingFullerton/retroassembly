import { twMerge } from 'tailwind-merge'
import { setVirtualGamepadAxis } from '#@/emulator/on-screen-gamepad.ts'
import { useStick } from './controls-kit.tsx'

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
    <div
      className={twMerge(
        'flex touch-none items-center justify-center rounded-full shadow-[inset_0_2px_6px_#000,0_0_0_2px_#333]',
        className,
      )}
      {...handlers}
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
