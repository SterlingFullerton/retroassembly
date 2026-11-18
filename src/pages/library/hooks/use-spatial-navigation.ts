import { off, on } from 'delegated-events'
import { useEffect, useEffectEvent } from 'react'
import { useNavigation } from 'react-router'
import { Gamepad } from '#@/utils/client/gamepad.ts'
import { useEmulatorLaunched, usePristine, useShowGameOverlayContent, useSpatialNavigationPaused } from '../atoms.ts'
import { useMouseIdle } from '../components/emulator-portal/hooks/use-mouse-idle.ts'
import { getKeyNameFromCode } from '../utils/keyboard.ts'
import {
  cancel,
  click,
  focus,
  init,
  isInDialog,
  isInMenu,
  jump,
  isArrowForMoving,
  move,
  navigableSelector,
  pressInMenu,
} from '../utils/spatial-navigation.ts'
import { useFocusIndicator } from './use-focus-indicator.ts'
import { useInputMapping } from './use-input-mapping.ts'
import { usePreference } from './use-preference.ts'

const nonTextInputs = new Set(['button', 'checkbox', 'color', 'file', 'radio', 'range', 'reset', 'submit'])

/** Whether keys go to a box being typed in, like a search box, rather than to moving around the page */
function isTypingIn(target: EventTarget | null) {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !nonTextInputs.has(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useSpatialNavigation() {
  const { state } = useNavigation()
  const inputMapping = useInputMapping()
  const { syncAfterScroll, syncStyle } = useFocusIndicator()
  const isIdle = useMouseIdle(100)
  const [emulatorLaunched] = useEmulatorLaunched()
  const [showGameOverlay] = useShowGameOverlayContent()
  const [spatialNavigationPaused] = useSpatialNavigationPaused()
  const { preference } = usePreference()

  const isNavigating = state === 'loading'
  const isPlaying = emulatorLaunched && !showGameOverlay
  // A dialog pauses the page behind it, but the keys still move in the dialog
  function isPaused() {
    return isNavigating || isPlaying || (spatialNavigationPaused && !isInDialog())
  }

  const { showFocusIndicators } = preference.ui

  const [pristine, setPristine] = usePristine()

  useEffect(() => {
    const initialPristine = {
      always: false,
      auto: true,
      never: false,
    }[showFocusIndicators]
    if (pristine) {
      setPristine(initialPristine === true)
    }
  }, [pristine, showFocusIndicators, setPristine])

  useEffect(init, [])

  // keyboard navigation
  const handleKeydown = useEffectEvent(async (event: KeyboardEvent) => {
    if (isPaused()) {
      return
    }
    // An open menu, such as Sort's, takes the arrows and Enter itself; the back key closes it, as Escape does
    if (isInMenu()) {
      const keyName = getKeyNameFromCode(event.code)
      if (event.key !== 'Escape' && (keyName === inputMapping.cancelKey || keyName === 'backspace')) {
        event.preventDefault()
        pressInMenu('Escape')
      } else if (keyName === inputMapping.confirmKey && keyName !== 'enter' && keyName !== 'space') {
        event.preventDefault()
        pressInMenu('Enter')
      }
      return
    }
    const keyboardDirectionMap = {
      [inputMapping.keyboard.input_player1_down]: 'down',
      [inputMapping.keyboard.input_player1_left]: 'left',
      [inputMapping.keyboard.input_player1_right]: 'right',
      [inputMapping.keyboard.input_player1_up]: 'up',

      down: 'down',
      left: 'left',
      right: 'right',
      up: 'up',
    } as const
    const keyName = getKeyNameFromCode(event.code)
    // In a text box, letters, Backspace, Enter and left and right are for typing; up and down still move out of it,
    // unless the box handled them itself
    if (isTypingIn(event.target) && ((keyName !== 'up' && keyName !== 'down') || event.defaultPrevented)) {
      return
    }
    const direction = keyboardDirectionMap[keyName]
    if (direction) {
      event.preventDefault()
      setPristine(showFocusIndicators === 'never')
      // With Shift, a jump: to the next part of the page, or the end of the row
      await (event.shiftKey ? jump(direction) : move(direction))
    } else if (keyName === inputMapping.confirmKey || keyName === 'enter' || keyName === 'space') {
      event.preventDefault()
      click(document.activeElement)
    } else if (keyName === inputMapping.cancelKey || keyName === 'backspace') {
      event.preventDefault()
      if (isInDialog()) {
        pressInMenu('Escape')
      } else {
        cancel()
      }
    }
  })

  // Before the control under the focus sees them, so it doesn't use them itself (see isArrowForMoving)
  const handleKeydownBeforeControls = useEffectEvent((event: KeyboardEvent) => {
    const arrows = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'])
    if (
      !isPaused() &&
      arrows.has(event.key) &&
      !isTypingIn(event.target) &&
      isArrowForMoving(event.target, event.key)
    ) {
      event.preventDefault()
    }
  })

  useEffect(() => {
    const abortController = new AbortController()

    document.addEventListener('keydown', handleKeydownBeforeControls, {
      capture: true,
      signal: abortController.signal,
    })
    document.addEventListener('keydown', handleKeydown, { signal: abortController.signal })
    return () => abortController.abort()
  }, [])

  // gamepad navigation
  const handleButtonDown = useEffectEvent(async ({ button }: { button: number }) => {
    if (isPaused()) {
      return
    }
    const gamepadDirectionMap = {
      [inputMapping.gamepad.input_player1_down_btn]: 'down',
      [inputMapping.gamepad.input_player1_left_btn]: 'left',
      [inputMapping.gamepad.input_player1_right_btn]: 'right',
      [inputMapping.gamepad.input_player1_up_btn]: 'up',
    } as const
    const direction = gamepadDirectionMap[button]
    // The shoulder buttons jump to the previous and next part of the page, as Shift and up or down do
    const jumpDirection = (
      {
        [inputMapping.gamepad.input_player1_l1_btn]: 'up',
        [inputMapping.gamepad.input_player1_r1_btn]: 'down',
      } as const
    )[button]
    if (jumpDirection && !isInMenu()) {
      setPristine(showFocusIndicators === 'never')
      await jump(jumpDirection)
      return
    }
    if (direction && isInMenu()) {
      pressInMenu({ down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp' }[direction])
      return
    }
    if (direction) {
      setPristine(showFocusIndicators === 'never')
      await move(direction)
    }
  })

  const handleButtonPress = useEffectEvent(({ button }: { button: number }) => {
    if (isPaused()) {
      return
    }
    if (isInMenu()) {
      if (`${button}` === inputMapping.confirmButton) {
        pressInMenu('Enter')
      } else if (`${button}` === inputMapping.cancelButton) {
        pressInMenu('Escape')
      }
      return
    }
    if (`${button}` === inputMapping.confirmButton) {
      click(document.activeElement)
    } else if (`${button}` === inputMapping.cancelButton) {
      if (isInDialog()) {
        pressInMenu('Escape')
      } else {
        cancel()
      }
    }
  })

  useEffect(() => {
    const offButtonDown = Gamepad.onButtonDown(handleButtonDown)
    const offButtonPress = Gamepad.onPress(handleButtonPress)

    return () => {
      offButtonDown()
      offButtonPress()
    }
  }, [])

  // focus when an element got hovered
  useEffect(() => {
    const eventName = 'mouseover'
    const selector = navigableSelector

    function handleMouseOver(event: Event) {
      if (!isIdle && event.currentTarget instanceof HTMLElement) {
        focus(event.currentTarget)
      }
    }
    on(eventName, selector, handleMouseOver)

    return () => off(eventName, selector, handleMouseOver)
  }, [isIdle])

  // auto resize or move the focus indicator
  useEffect(() => {
    const abortController = new AbortController()
    const options = { capture: true, signal: abortController.signal }
    document.addEventListener('scroll', (event) => syncAfterScroll(event.target), options)
    document.addEventListener('focusin', () => syncStyle(), options)
    globalThis.addEventListener('resize', () => syncStyle({ transition: false }), { signal: abortController.signal })
    return () => abortController.abort()
  }, [syncAfterScroll, syncStyle])

  return { pristine }
}
