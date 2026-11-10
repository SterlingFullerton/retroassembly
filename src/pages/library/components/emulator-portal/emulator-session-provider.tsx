import { createContext, type ReactNode, useContext, useReducer } from 'react'
import { useGamepadMapping, type GamepadMapping } from '#@/pages/library/hooks/use-gamepad-mapping.ts'

const EmulatorGamepadMappingContext = createContext<GamepadMapping | null>(null)
// A lazy session downloads the game and emulator only when the game is launched, instead of when the page opens
const EmulatorLazyContext = createContext(false)

export function EmulatorSessionProvider({ children, lazy = false }: Readonly<{ children: ReactNode; lazy?: boolean }>) {
  const gamepadMapping = useGamepadMapping()
  const [emulatorGamepadMapping] = useReducer((mapping: GamepadMapping) => mapping, gamepadMapping)

  return (
    <EmulatorGamepadMappingContext.Provider value={emulatorGamepadMapping}>
      <EmulatorLazyContext.Provider value={lazy}>{children}</EmulatorLazyContext.Provider>
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
