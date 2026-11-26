// A switch kept in this browser, not with the account, so turning it on for one device turns it on for no other

/** A switch kept under `storageKey`: whether it's on, a way to set it, and a way to hear of changes */
export function createDeviceSwitch(storageKey: string) {
  function load() {
    try {
      return globalThis.localStorage?.getItem(storageKey) === '1'
    } catch {
      return false
    }
  }

  let enabled = load()
  const listeners = new Set<() => void>()

  return {
    isEnabled: () => enabled,
    setEnabled(value: boolean) {
      enabled = value
      try {
        if (value) {
          globalThis.localStorage?.setItem(storageKey, '1')
        } else {
          globalThis.localStorage?.removeItem(storageKey)
        }
      } catch {}
      for (const listener of listeners) {
        listener()
      }
    },
    /** Calls `listener` whenever the switch changes, until the function it returns is called */
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
