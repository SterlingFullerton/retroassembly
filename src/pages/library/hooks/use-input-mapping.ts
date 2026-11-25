import { useMemo } from 'react'
import { getNavigationKeys } from '#@/input/navigation-keys.ts'
import { useConfirmButtonStyle } from './use-confirm-button-style.ts'
import { useGamepadMapping } from './use-gamepad-mapping.ts'
import { useKeyboardMapping } from './use-keyboard-mapping.ts'

export function useInputMapping() {
  const gamepadMapping = useGamepadMapping()
  const keyboardMapping = useKeyboardMapping()
  const confirmButtonStyle = useConfirmButtonStyle()

  // The library's own keys, which start out as the shared layout's
  const navigationKeys = useMemo(
    () => getNavigationKeys(keyboardMapping, confirmButtonStyle),
    [keyboardMapping, confirmButtonStyle],
  )
  const { $cancel: cancelKey, $confirm: confirmKey } = navigationKeys

  const confirmButton = {
    nintendo: gamepadMapping.input_player1_a_btn,
    xbox: gamepadMapping.input_player1_b_btn,
  }[confirmButtonStyle]

  const cancelButton = {
    nintendo: gamepadMapping.input_player1_b_btn,
    xbox: gamepadMapping.input_player1_a_btn,
  }[confirmButtonStyle]

  const mapping = useMemo(
    () => ({
      cancelButton,
      cancelKey,
      confirmButton,
      confirmKey,
      gamepad: gamepadMapping,
      keyboard: keyboardMapping,
      navigationKeys,
    }),
    [gamepadMapping, keyboardMapping, navigationKeys, cancelButton, cancelKey, confirmButton, confirmKey],
  )
  return mapping
}
