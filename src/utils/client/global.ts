import { isBrowser } from 'es-toolkit'

if (isBrowser()) {
  try {
    if (navigator.webdriver) {
      delete globalThis.showOpenFilePicker
    }
  } catch {}
}

// What a finger or the mouse is pressing is marked, so it can look pressed straight away (see globals.css). Marked here
// rather than left to :active, which phones apply late or, on iPhones and iPads, not at all
const pressable =
  "a[href], button, [role='button'], [role='tab'], [role='combobox'], [role='menuitem'], [role='option'], summary"

let pressed: HTMLElement | undefined

function release() {
  if (pressed) {
    delete pressed.dataset.pressed
  }
  pressed = undefined
}

if (isBrowser()) {
  document.addEventListener(
    'pointerdown',
    (event) => {
      release()
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(pressable) : null
      // The on-screen game buttons draw their own pressed look
      if (target && !target.closest('[data-virtual-gamepad-button-id]') && !target.matches(':disabled')) {
        pressed = target
        target.dataset.pressed = ''
      }
    },
    { capture: true, passive: true },
  )
  for (const type of ['pointerup', 'pointercancel', 'dragstart', 'scroll'] as const) {
    document.addEventListener(type, release, { capture: true, passive: true })
  }
  globalThis.addEventListener('blur', release)
}
