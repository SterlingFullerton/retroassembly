import { createContext, type ReactNode, useContext, useMemo, useReducer } from 'react'
import { useGamepadMapping, type GamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { useEmulatorSessionController } from './hooks/use-emulator.ts'

const EmulatorGamepadMappingContext = createContext<GamepadMapping | null>(null)
// A lazy session downloads the game and emulator only when the game is launched, instead of when the page opens
const EmulatorLazyContext = createContext(false)
const SessionContext = createContext<null | ReturnType<typeof useEmulatorSessionController>>(null)

// One game session: the game, its emulator and everything about playing it, shared by every part of the game screen
function Session({ children, lazy }: Readonly<{ children: ReactNode; lazy: boolean }>) {
  const emulatorGamepadMapping = useEmulatorGamepadMapping()
  const session = useEmulatorSessionController({ emulatorGamepadMapping, lazy })
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function EmulatorSessionProvider({ children, lazy = false }: Readonly<{ children: ReactNode; lazy?: boolean }>) {
  const gamepadMapping = useGamepadMapping()
  const [emulatorGamepadMapping] = useReducer((mapping: GamepadMapping) => mapping, gamepadMapping)

  return (
    <EmulatorGamepadMappingContext.Provider value={emulatorGamepadMapping}>
      <EmulatorLazyContext.Provider value={lazy}>
        <Session lazy={lazy}>{children}</Session>
      </EmulatorLazyContext.Provider>
    </EmulatorGamepadMappingContext.Provider>
  )
}

export function useEmulatorLazy() {
  return useContext(EmulatorLazyContext)
}

export function useEmulatorGamepadMapping() {
  const gamepadMapping = useContext(EmulatorGamepadMappingContext)
  if (!gamepadMapping) {
    throw new Error('useEmulatorGamepadMapping must be used within EmulatorSessionProvider')
  }

  return gamepadMapping
}

/**
 * For the test-only controls page (src/pages/routes/dev-controls.tsx): a session with no game, whose emulator is a
 * stand-in that records the buttons pressed
 */
export function TestSessionProvider({
  children,
  emulator,
}: Readonly<{
  children: ReactNode
  emulator: { getStatus: () => string; pressDown: (button: string) => void; pressUp: (button: string) => void }
}>) {
  const session = useMemo(
    () => ({ emulator }) as unknown as ReturnType<typeof useEmulatorSessionController>,
    [emulator],
  )
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

/** The game session around this component */
export function useSession() {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession must be used within EmulatorSessionProvider')
  }
  return session
}
