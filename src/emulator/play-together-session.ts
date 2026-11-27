import type { Nostalgist } from 'nostalgist'
import { createDeviceSwitch } from '#@/utils/client/device-switch.ts'
import { getOwnAddress, invite } from './play-together-signal.ts'
import { hostGame } from './play-together.ts'

// The game this device is sharing, if it is: one at a time, from the moment the host asks for a code until they stop
// or leave the game. It outlives the pause menu that started it, so it's kept here and not in the menu

/** Playing together is an experiment, shown only on devices where it's switched on */
export const playTogetherSwitch = createDeviceSwitch('retroassembly-play-together')

/**
 * Whether a guest must be told a code to join. Off, the game is shown to everyone signed in, which suits a household:
 * a code is awkward to type with a controller. It's this device's own choice
 */
export const joinCodeSwitch = createDeviceSwitch('retroassembly-play-together-code')

export type Sharing =
  | { stage: 'failed' | 'idle' | 'starting' }
  /** Waiting for a guest: one who's told `code`, or with the game listed, anyone signed in */
  | { code: string; listed: boolean; stage: 'inviting' }
  | { stage: 'connected' }

let sharing: Sharing = { stage: 'idle' }
let stop: (() => void) | undefined
let connection: RTCPeerConnection | undefined
const listeners = new Set<() => void>()

function set(next: Sharing) {
  sharing = next
  for (const listener of listeners) {
    listener()
  }
}

export function getSharing() {
  return sharing
}

/** The connection to the guest, while one has joined: for reading how the picture is travelling */
export function getSharingConnection() {
  return sharing.stage === 'connected' ? connection : undefined
}

/** Calls `listener` whenever what's being shared changes, until the function it returns is called */
export function subscribeSharing(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stops sharing: the guest loses the game, and their controller is taken away. Nothing happens when nothing's shared */
export function stopSharing() {
  stop?.()
  stop = undefined
  connection = undefined
  if (sharing.stage !== 'idle') {
    set({ stage: 'idle' })
  }
}

interface ShareOptions {
  /** The console's on-screen controls, by name */
  controls: string
  /** The emulator, and its console, for the guest's keys */
  core: string
  emulator: Nostalgist
  platform: string
  title: string
}

/** Shares the game `emulator` runs with one guest, who joins by the code this arrives at */
export async function startSharing({ controls, core, emulator, platform, title }: ShareOptions) {
  stopSharing()
  set({ stage: 'starting' })
  let stopped = false
  let host: ReturnType<typeof hostGame> | undefined
  let invitation: Awaited<ReturnType<typeof invite>> | undefined
  stop = () => {
    stopped = true
    host?.close()
    // Taken back in the background: nothing waits on it, and withdraw() answers for its own failures
    // oxlint-disable-next-line typescript/no-floating-promises -- stopping can't wait, and it can't fail
    invitation?.withdraw()
  }
  try {
    const listed = !joinCodeSwitch.isEnabled()
    const reachableAt = await getOwnAddress()
    host = hostGame({
      canvas: emulator.getCanvas(),
      emulator,
      onGuest(connected) {
        if (!stopped) {
          // A guest who leaves ends the sharing: the code they joined by is spent
          if (connected) {
            set({ stage: 'connected' })
          } else {
            stopSharing()
          }
        }
      },
      reachableAt,
    })
    ;({ connection } = host)
    const offer = await host.offer()
    invitation = await invite({ controls, core, offer, platform, title }, listed)
    if (stopped) {
      await invitation.withdraw()
      return
    }
    set({ code: invitation.code, listed, stage: 'inviting' })
    await host.accept(await invitation.answer)
  } catch {
    if (!stopped) {
      stop()
      stop = undefined
      set({ stage: 'failed' })
    }
  }
}
