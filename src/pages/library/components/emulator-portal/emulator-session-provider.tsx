import { createContext, type ReactNode, useContext, useMemo, useReducer } from 'react'
import { useGamepadMapping, type GamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useEmulatorSessionController } from './hooks/use-emulator.ts'

const EmulatorGamepadMappingContext = createContext<GamepadMapping | null>(null)
const SessionContext = createContext<null | ReturnType<typeof useEmulatorSessionController>>(null)

// One game session: the game, its emulator and everything about playing it, shared by every part of the game screen
function Session({ children }: Readonly<{ children: ReactNode }>) {
  const emulatorGamepadMapping = useEmulatorGamepadMapping()
  const session = useEmulatorSessionController({ emulatorGamepadMapping })
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

/**
 * A session for the page's game. Another game, reached on the same page, or another emulator picked for it, gets a
 * session of its own: nothing of the last one's, such as its own save, carries over
 */
export function EmulatorSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const gamepadMapping = useGamepadMapping()
  const [emulatorGamepadMapping] = useReducer((mapping: GamepadMapping) => mapping, gamepadMapping)
  const rom = useRom()
  const { preference } = usePreference()
  const core = preference.emulator.platform[rom.platform]?.core

  return (
    <EmulatorGamepadMappingContext.Provider value={emulatorGamepadMapping}>
      <Session key={`${rom.id} ${core}`}>{children}</Session>
    </EmulatorGamepadMappingContext.Provider>
  )
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
