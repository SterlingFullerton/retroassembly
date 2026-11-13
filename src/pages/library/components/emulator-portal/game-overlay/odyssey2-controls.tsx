import { clsx } from 'clsx'
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { useControlsScale } from '#@/pages/library/hooks/use-controls-scale.ts'
import { useEmulator } from '../hooks/use-emulator.ts'
import { Joystick } from './joystick.tsx'
import { VirtualGamepadButton } from './virtual-gamepad-button.tsx'

// The Odyssey²'s controls: its joystick and one red action button, as on its controller, and a Keyboard button that
// brings up the phone's own keyboard for the console's keyboard, which most games ask for a number from before they
// start. O2EM reads the joystick from the d-pad, the action button from B, and the console's keyboard from the
// keyboard. What's typed goes to a hidden text field, and each character presses its key in the emulator
const pressed = 'data-[touching=true]:brightness-110 data-[touching=true]:scale-95'
const actionStyle: CSSProperties = {
  background: 'radial-gradient(circle at 40% 30%, #ff5a5a, #d01818 60%, #8a0c0c)',
  boxShadow: '0 3px 4px #000a, inset 0 2px 0 #ff9a9a, inset 0 -3px 0 #0004',
}
const plainStyle: CSSProperties = { background: 'linear-gradient(#3a3a3d, #202022)' }

// The keys besides letters and digits that O2EM reads and RetroArch's web build has a key for; × and ÷ are typed as ✱
// and /, but RetroArch's web build has no key for the Odyssey²'s ✱, + or ?
const characterCodes: Record<string, string> = {
  ' ': 'Space',
  '-': 'Minus',
  '.': 'Period',
  '/': 'Slash',
  '=': 'Equal',
  '÷': 'Slash',
  '−': 'Minus',
}

/** The key, by its name in the browser, that a typed character presses on the Odyssey²'s keyboard */
function getKeyCode(character: string) {
  if (/^[a-z]$/iu.test(character)) {
    return `Key${character.toUpperCase()}`
  }
  if (/^\d$/u.test(character)) {
    return `Digit${character}`
  }
  return characterCodes[character]
}

// Pressing the Keyboard button mustn't take the focus from the field first, or it would bring the keyboard straight back
function keepFocus(event: PointerEvent) {
  event.preventDefault()
}

// The hidden field holds a space between keys, so that backspace always has something to delete: phone keyboards
// often say nothing when backspace is pressed in an empty field
const resting = ' '

export function Odyssey2Controls({ visible }: Readonly<{ visible: boolean }>) {
  const hidden = clsx({ hidden: !visible })
  // Each side's controls are about 160 points wide; on smaller screens they shrink towards their corner. Each group
  // hangs off a point with no size at its corner, which is where it shrinks towards
  const scale = useControlsScale(160)
  const { emulator } = useEmulator()
  const field = useRef<HTMLInputElement>(null)
  const [typing, setTyping] = useState(false)
  // Keys typed quickly are pressed one after another, each held long enough for the game to see it
  const queue = useRef<string[]>([])
  const pressing = useRef(false)

  // Sends a key to RetroArch the way the emulator's own buttons do: straight to its keyboard handlers, as if from the
  // game's canvas. A real key press in the field isn't seen by RetroArch, which ignores text fields
  function fire(type: 'keydown' | 'keyup', code: string) {
    if (!emulator) {
      return
    }
    const { JSEvents } = emulator.getEmscripten()
    const target = emulator.getCanvas()
    for (const { eventListenerFunc, eventTypeString } of JSEvents.eventHandlers) {
      if (eventTypeString === type) {
        try {
          eventListenerFunc({ code, target })
        } catch {}
      }
    }
  }

  // Presses the next key waiting, holds it, and lets go long enough for the game to notice before the one after
  function pressNext() {
    const code = queue.current.shift()
    if (!code) {
      pressing.current = false
      return
    }
    pressing.current = true
    fire('keydown', code)
    setTimeout(() => {
      fire('keyup', code)
      setTimeout(pressNext, 50)
    }, 100)
  }

  function press(code: string) {
    queue.current.push(code)
    if (!pressing.current) {
      pressNext()
    }
  }

  function rest() {
    const input = field.current
    if (input) {
      input.value = resting
      input.setSelectionRange(resting.length, resting.length)
    }
  }

  // Keyboards that say which key was pressed (an iPhone's, or one plugged in) are read here, and the character isn't
  // typed into the field. Enter presses Enter, and backspace presses Clear, which O2EM reads from End
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      press('Enter')
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      press('End')
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const code = getKeyCode(event.key)
      if (code) {
        press(code)
      }
    }
  }

  // Keyboards that only say the text changed, such as Android's, are read from what's now in the field
  function handleInput(event: { currentTarget: HTMLInputElement }) {
    const { value } = event.currentTarget
    if (value.length < resting.length) {
      press('End')
    } else {
      for (const character of value.replace(resting, '')) {
        const code = getKeyCode(character)
        if (code) {
          press(code)
        }
      }
    }
    rest()
  }

  function toggleKeyboard() {
    if (typing) {
      field.current?.blur()
    } else {
      rest()
      field.current?.focus()
    }
  }

  return (
    <>
      <input
        aria-label='Odyssey² keyboard'
        autoCapitalize='none'
        autoComplete='off'
        autoCorrect='off'
        className='pointer-events-none fixed top-0 left-0 size-px opacity-0'
        defaultValue={resting}
        enterKeyHint='enter'
        onBlur={() => setTyping(false)}
        onFocus={() => setTyping(true)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => event.stopPropagation()}
        ref={field}
        spellCheck={false}
        // Smaller text makes an iPhone zoom in when the field gets the focus
        style={{ fontSize: 16 }}
        tabIndex={-1}
      />

      <div className={twMerge('bottom-safe left-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <div className='absolute bottom-16 left-5 size-37.5 landscape:bottom-15 landscape:left-3 landscape:size-34'>
          <Joystick />
        </div>
      </div>

      <div className={twMerge('bottom-safe right-safe absolute size-0 origin-top-left', hidden)} style={{ scale }}>
        <VirtualGamepadButton
          buttonName='b'
          className={twMerge(
            pressed,
            'absolute right-9 bottom-23 size-24 rounded-full text-xs font-extrabold tracking-wider text-white landscape:right-7.5 landscape:bottom-20 landscape:size-21 landscape:text-[11px]',
          )}
          style={actionStyle}
          title='Action'
        >
          ACTION
        </VirtualGamepadButton>
      </div>

      {/* Keyboard: between the hands in portrait, under pause in landscape */}
      <div
        className={twMerge(
          'bottom-safe landscape:top-safe landscape:left-safe absolute left-1/2 size-0 origin-top-left landscape:bottom-auto',
          hidden,
        )}
        style={{ scale }}
      >
        <div className='absolute bottom-[250px] left-0 -translate-x-1/2 landscape:top-[52px] landscape:bottom-auto landscape:left-3 landscape:translate-x-0'>
          <button
            aria-pressed={typing}
            className='flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold tracking-wider whitespace-nowrap text-[#e8e8ea] shadow-[0_2px_3px_#0008,inset_0_1px_0_#ffffff22] active:scale-95 active:brightness-125'
            onClick={toggleKeyboard}
            onPointerDown={keepFocus}
            style={plainStyle}
            title='Keyboard'
            type='button'
          >
            <span className='icon-[mdi--keyboard] size-3.5' />
            KEYBOARD
          </button>
        </div>
      </div>
    </>
  )
}
