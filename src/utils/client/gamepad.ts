import { pull } from 'es-toolkit'
import { GamepadListener } from 'gamepad.js'

interface GamepadButtonEvent {
  button: number
  gamepad: Gamepad
  index: number
  pressed: boolean
  value: number
}

type Timer = ReturnType<typeof setTimeout>

/**
 * The controller that drives menus and settings: the first one connected, wherever the browser lists it. With the first
 * one turned off, or a device that isn't one listed first, the next one still works
 */
export function getActiveGamepad() {
  let gamepads: (Gamepad | null)[] = []
  // A page the browser doesn't allow controllers on throws
  try {
    gamepads = navigator.getGamepads?.() ?? []
  } catch {}
  return gamepads.find((gamepad) => gamepad?.connected) ?? undefined
}

export const Gamepad = {
  callbacksMap: {} as Record<string, ((event: GamepadButtonEvent) => void)[]>,
  initialized: false,
  timers: {} as Record<number, Timer>,

  handleButton(event: { detail: GamepadButtonEvent }) {
    const { button, index, pressed } = event.detail
    if (index !== getActiveGamepad()?.index) {
      return
    }

    if (pressed) {
      Gamepad.trigger('press', event.detail)
      Gamepad.trigger('down', event.detail)
      Gamepad.startRepeat(button, event.detail)
    } else {
      Gamepad.stopRepeat(button)
      Gamepad.trigger('up', event.detail)
    }
  },

  trigger(eventName: string, detail: GamepadButtonEvent) {
    const callbacks = Gamepad.callbacksMap[eventName]
    if (callbacks) {
      for (const callback of callbacks) {
        callback(detail)
      }
    }
  },

  initialize() {
    if (typeof globalThis.navigator?.getGamepads !== 'function') {
      return
    }
    if (Gamepad.initialized) {
      return
    }
    const listener = new GamepadListener({ button: { analog: false } })
    listener.start()
    Gamepad.initialized = true
    listener.on('gamepad:button', Gamepad.handleButton.bind(Gamepad))
    // A controller that drops while a button is held never says the button was let go
    listener.on('gamepad:disconnected', Gamepad.stopRepeats.bind(Gamepad))
    document.addEventListener('visibilitychange', Gamepad.stopRepeats.bind(Gamepad))
  },

  onButtonDown(callback: (event: GamepadButtonEvent) => void) {
    const eventName = 'down'
    Gamepad.callbacksMap[eventName] ??= []
    Gamepad.callbacksMap[eventName].push(callback)
    const callbacks = Gamepad.callbacksMap[eventName]
    this.initialize()
    return () => {
      pull(callbacks, [callback])
    }
  },

  onButtonUp(callback: (event: GamepadButtonEvent) => void) {
    const eventName = 'up'
    Gamepad.callbacksMap[eventName] ??= []
    Gamepad.callbacksMap[eventName].push(callback)
    const callbacks = Gamepad.callbacksMap[eventName]
    this.initialize()
    return () => {
      pull(callbacks, [callback])
    }
  },

  onPress(callback: (event: GamepadButtonEvent) => void) {
    const eventName = 'press'
    Gamepad.callbacksMap[eventName] ??= []
    Gamepad.callbacksMap[eventName].push(callback)
    const callbacks = Gamepad.callbacksMap[eventName]
    this.initialize()
    return () => {
      pull(callbacks, [callback])
    }
  },

  startRepeat(button: number, detail: GamepadButtonEvent) {
    Gamepad.stopRepeat(button)
    Gamepad.timers[button] = setTimeout(() => {
      Gamepad.timers[button] = setInterval(() => {
        // Repeated only while the button is still held on a controller that's still there
        const gamepad = navigator.getGamepads?.()[detail.index]
        if (!gamepad?.connected || !gamepad.buttons[button]?.pressed) {
          Gamepad.stopRepeat(button)
          return
        }
        Gamepad.trigger('down', detail)
      }, 100)
    }, 500)
  },

  stopRepeats() {
    for (const button of Object.keys(Gamepad.timers)) {
      Gamepad.stopRepeat(Number(button))
    }
  },

  stopRepeat(button: number) {
    if (Gamepad.timers[button]) {
      clearTimeout(Gamepad.timers[button])
      clearInterval(Gamepad.timers[button])
      delete Gamepad.timers[button]
    }
  },
}
