import { useState } from 'react'
import { useParams } from 'react-router'
import { connectTestOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { TestSessionProvider } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import {
  ConsoleControls,
  hasConsoleControls,
} from '#@/pages/library/components/emulator-portal/game-overlay/console-controls.tsx'

// What the controls sent, for a test to read: the emulator's buttons pressed and let go, and the on-screen gamepad
declare global {
  var testControls: { gamepad: ReturnType<typeof connectTestOnScreenGamepad>; presses: string[] } | undefined
}

function Controls({ kind }: Readonly<{ kind: string }>) {
  const [keypadOpen, setKeypadOpen] = useState(false)
  return (
    <>
      {hasConsoleControls(kind) ? (
        <ConsoleControls keypadOpen={keypadOpen} kind={kind} onKeypadClose={() => setKeypadOpen(false)} />
      ) : (
        <p className='p-4 text-white'>No controls called {kind}</p>
      )}
      {/* Opens the ColecoVision's and Atari 5200's keypads, as the button beside pause does */}
      <button
        aria-label='Open keypad'
        className='hidden'
        data-testid='open-keypad'
        onClick={() => setKeypadOpen(true)}
        type='button'
      />
    </>
  )
}

export default function DevControlsRoute() {
  const { kind = '' } = useParams()
  // eslint-disable-next-line react/hook-use-state -- made once, and never changed
  const [emulator] = useState(() => {
    // Development runs this twice, so both runs record into the same list
    globalThis.testControls ??= { gamepad: connectTestOnScreenGamepad(), presses: [] }
    const { presses } = globalThis.testControls
    return {
      getStatus: () => 'running',
      pressDown: (button: string) => presses.push(`down ${button}`),
      pressUp: (button: string) => presses.push(`up ${button}`),
    }
  })

  return (
    <TestSessionProvider emulator={emulator}>
      <div className='fixed inset-0 block touch-none bg-black'>
        <Controls kind={kind} />
      </div>
    </TestSessionProvider>
  )
}
