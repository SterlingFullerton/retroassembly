import { clsx } from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// Start, Select and the console's other buttons that aren't for playing (Mode, Run, Reset, Flip disk and so on) sit in
// the top bar straight after pause, in its style, on every console and both ways up: a label with no background that
// lights up while pressed, as tall as a finger needs. On phones narrower than 375 points the labels lose their spacing, so the longest bar, the
// Lynx's, still fits beside rewind, fast forward and the gamepad toggle.
const topBarButton = twMerge(
  'h-11 rounded px-1.5 text-[10px] font-semibold tracking-wider whitespace-nowrap text-white/75 data-[touching=true]:bg-white/25',
  'max-[374px]:portrait:px-1 max-[374px]:portrait:tracking-normal',
)

export function TopBarButton({ className, ...props }: Readonly<ComponentProps<typeof VirtualGamepadButton>>) {
  return <VirtualGamepadButton className={twMerge(topBarButton, className)} {...props} />
}

// Rendered at the top level of a console's controls, not inside a scaled or positioned box, so it lines up with pause.
// The ColecoVision's and Atari 5200's keypad button comes first, after pause, and these after it
export function TopBarButtons({
  afterKeypad = false,
  children,
  visible,
}: Readonly<{ afterKeypad?: boolean; children: ReactNode; visible: boolean }>) {
  return (
    <div
      className={clsx('top-safe absolute flex', afterKeypad ? 'left-safe-offset-22' : 'left-safe-offset-11', {
        hidden: !visible,
      })}
    >
      {children}
    </div>
  )
}
