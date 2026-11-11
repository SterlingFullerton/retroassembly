import { clsx } from 'clsx'
import { type ButtonHTMLAttributes, type PointerEvent, useEffect, useId, useMemo, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { useEmulator } from '../hooks/use-emulator.ts'

interface VirtualGamepadButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  buttonName?: string
  buttonNames?: string[]
  // A finger can slide between buttons of the same group, like the d-pad's directions, but not onto another button
  group?: string
  onVirtualPressEnd?: () => void
  onVirtualPressStart?: () => void
}

interface VirtualGamepadButtonRegistration {
  activePointerIds: Set<number>
  buttonNames: string[]
  group: string
  emulator?: {
    pressDown: (buttonName: string) => void
    pressUp: (buttonName: string) => void
  }
  onVirtualPressEnd?: () => void
  onVirtualPressStart?: () => void
  setTouching: (touching: boolean) => void
}

const virtualGamepadButtons = new Map<string, VirtualGamepadButtonRegistration>()
const activePointerButtonIds = new Map<number, string>()
// The group of the button each finger first touched
const pointerGroups = new Map<number, string>()

function getVirtualGamepadButtonIdFromPoint(event: PointerEvent<HTMLButtonElement>) {
  return document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>('[data-virtual-gamepad-button-id]')?.dataset.virtualGamepadButtonId
}

function pressButton(buttonId: string, pointerId: number) {
  if (activePointerButtonIds.get(pointerId) === buttonId) {
    return
  }

  releasePointer(pointerId)

  const button = virtualGamepadButtons.get(buttonId)
  if (!button) {
    return
  }

  const wasInactive = button.activePointerIds.size === 0
  button.activePointerIds.add(pointerId)
  activePointerButtonIds.set(pointerId, buttonId)
  button.setTouching(true)

  if (wasInactive) {
    button.onVirtualPressStart?.()
  }

  if (wasInactive && button.emulator) {
    for (const buttonName of button.buttonNames) {
      button.emulator.pressDown(buttonName)
    }
  }
}

function releaseButton(buttonId: string) {
  const button = virtualGamepadButtons.get(buttonId)
  if (!button) {
    return
  }

  if (button.emulator) {
    for (const buttonName of button.buttonNames) {
      button.emulator.pressUp(buttonName)
    }
  }
  button.onVirtualPressEnd?.()
  button.setTouching(false)
}

function releasePointer(pointerId: number) {
  const buttonId = activePointerButtonIds.get(pointerId)
  if (!buttonId) {
    return
  }

  activePointerButtonIds.delete(pointerId)

  const button = virtualGamepadButtons.get(buttonId)
  if (!button) {
    return
  }

  button.activePointerIds.delete(pointerId)
  if (button.activePointerIds.size === 0) {
    releaseButton(buttonId)
  }
}

function releasePointersByButtonId(buttonId: string) {
  const button = virtualGamepadButtons.get(buttonId)
  if (!button) {
    return
  }

  for (const pointerId of button.activePointerIds) {
    activePointerButtonIds.delete(pointerId)
  }
  button.activePointerIds.clear()
  releaseButton(buttonId)
}

function endPointer(pointerId: number) {
  releasePointer(pointerId)
  pointerGroups.delete(pointerId)
}

function handleGlobalPointerEnd(event: globalThis.PointerEvent) {
  endPointer(event.pointerId)
}

function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
  if (event.buttons === 0) {
    endPointer(event.pointerId)
    return
  }

  const buttonId = getVirtualGamepadButtonIdFromPoint(event)
  const group = buttonId ? virtualGamepadButtons.get(buttonId)?.group : undefined
  if (buttonId && group === pointerGroups.get(event.pointerId)) {
    pressButton(buttonId, event.pointerId)
  } else {
    releasePointer(event.pointerId)
  }
}

function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
  endPointer(event.pointerId)
}

export function VirtualGamepadButton({
  buttonName,
  buttonNames,
  children,
  className,
  group,
  onVirtualPressEnd,
  onVirtualPressStart,
  ...props
}: Readonly<VirtualGamepadButtonProps>) {
  const { emulator } = useEmulator()
  const [touching, setTouching] = useState(false)
  const id = useId()

  const resolvedButtonNames = useMemo(() => buttonNames || (buttonName ? [buttonName] : []), [buttonName, buttonNames])

  useEffect(() => {
    virtualGamepadButtons.set(id, {
      activePointerIds: new Set(),
      buttonNames: resolvedButtonNames,
      emulator,
      // A button without a group is a group of its own, which no other finger can slide onto
      group: group ?? id,
      onVirtualPressEnd,
      onVirtualPressStart,
      setTouching,
    })

    return () => {
      releasePointersByButtonId(id)
      virtualGamepadButtons.delete(id)
    }
  }, [emulator, group, id, onVirtualPressEnd, onVirtualPressStart, resolvedButtonNames])

  useEffect(() => {
    const button = virtualGamepadButtons.get(id)
    if (button) {
      button.buttonNames = resolvedButtonNames
      button.emulator = emulator
      button.group = group ?? id
      button.onVirtualPressEnd = onVirtualPressEnd
      button.onVirtualPressStart = onVirtualPressStart
    }
  }, [emulator, group, id, onVirtualPressEnd, onVirtualPressStart, resolvedButtonNames])

  useEffect(() => {
    const abortController = new AbortController()
    document.body.addEventListener('pointercancel', handleGlobalPointerEnd, { signal: abortController.signal })
    document.body.addEventListener('pointerup', handleGlobalPointerEnd, { signal: abortController.signal })
    return () => abortController.abort()
  }, [])

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (resolvedButtonNames.length > 0 || onVirtualPressStart) {
      event.preventDefault()
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    pointerGroups.set(event.pointerId, group ?? id)
    pressButton(id, event.pointerId)
  }

  return (
    <button
      data-touching={touching}
      data-virtual-gamepad-button-id={id}
      className={twMerge(
        clsx(
          'inline-flex touch-none items-center justify-center gap-1 select-none',
          touching ? 'bg-white text-(--color-text)' : 'bg-black/20 text-white/50',
        ),
        className,
      )}
      type='button'
      {...props}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {children}
    </button>
  )
}
