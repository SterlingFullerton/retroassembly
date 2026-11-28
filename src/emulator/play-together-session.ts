import { attemptAsync } from 'es-toolkit'
import type { Nostalgist } from 'nostalgist'
import { createDeviceSwitch } from '#@/utils/client/device-switch.ts'
import { type Answer, getOwnAddress, type Invitation, invite } from './play-together-signal.ts'
import { hostGame, type HostOptions } from './play-together.ts'

// The game this device is sharing, if it is: one at a time, from the moment the host asks for a code until they stop
// or leave the game. It outlives the pause menu that started it, so it's kept here and not in the menu

/**
 * Whether a guest must be told a code to join. Off, the game is shown to everyone signed in, which suits a household:
 * a code is awkward to type with a controller. It's this device's own choice
 */
export const joinCodeSwitch = createDeviceSwitch('retroassembly-play-together-code')

export type Sharing =
  | { stage: 'failed' | 'idle' | 'starting' }
  /** Waiting for a guest: one who's told `code`, or with the game listed, anyone signed in */
  | { code: string; listed: boolean; stage: 'inviting' }
  /** A guest has joined, as `player` (counting from 1), and by their username when the server says */
  | { guest?: string; player: number; stage: 'connected' }

export interface ShareOptions {
  /** The console's on-screen controls, by name */
  controls: string
  /** The emulator, and its console, for the guest's keys */
  core: string
  emulator: Nostalgist
  platform: string
  title: string
}

/** What sharing is made of, given apart so it can be tried without a network or an emulator */
export interface SharingParts {
  getOwnAddress: () => Promise<string>
  hostGame: (options: HostOptions) => Pick<ReturnType<typeof hostGame>, 'accept' | 'close' | 'connection' | 'offer'>
  invite: (
    invitation: Invitation,
    listed: boolean,
  ) => Promise<{ answer: Promise<Answer>; code: string; withdraw: () => Promise<void> }>
  /** Whether the game is shown to everyone signed in, rather than found by its code alone */
  isListed: () => boolean
}

/** One device's sharing: what it is now, and the ways to start and stop it */
export function createSharing(parts: SharingParts) {
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

  function getSharing() {
    return sharing
  }

  /** The connection to the guest, while one has joined: for reading how the picture is travelling */
  function getSharingConnection() {
    return sharing.stage === 'connected' ? connection : undefined
  }

  /** Calls `listener` whenever what's being shared changes, until the function it returns is called */
  function subscribeSharing(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * Stops sharing: the guest loses the game, and their controller is taken away. Nothing happens when nothing's shared
   */
  function stopSharing() {
    stop?.()
    stop = undefined
    connection = undefined
    if (sharing.stage !== 'idle') {
      set({ stage: 'idle' })
    }
  }

  /** Shares the game `emulator` runs with one guest, who joins by the code this arrives at */
  async function startSharing({ controls, core, emulator, platform, title }: ShareOptions) {
    stopSharing()
    set({ stage: 'starting' })
    // This sharing's own: once it's stopped, by the host or by another sharing starting, nothing it was waiting for
    // changes what's shown
    let stopped = false
    let host: ReturnType<SharingParts['hostGame']> | undefined
    let invitation: Awaited<ReturnType<SharingParts['invite']>> | undefined
    let guest: string | undefined
    stop = () => {
      stopped = true
      host?.close()
      // Taken back in the background: nothing waits on it, and withdraw() answers for its own failures
      // oxlint-disable-next-line typescript/no-floating-promises -- stopping can't wait, and it can't fail
      invitation?.withdraw()
    }
    function fail() {
      if (!stopped) {
        stopSharing()
        set({ stage: 'failed' })
      }
    }
    try {
      const listed = parts.isListed()
      const reachableAt = await parts.getOwnAddress()
      if (stopped) {
        return
      }
      host = parts.hostGame({
        canvas: emulator.getCanvas(),
        emulator,
        onGuest(connected, player) {
          if (stopped) {
            return
          }
          if (connected && player) {
            set({ guest, player, stage: 'connected' })
          } else if (connected || sharing.stage !== 'connected') {
            // Every controller's place is taken, or the guest answered but their device couldn't reach this one: the
            // code is spent, and the host can invite again
            fail()
          } else {
            // A guest who leaves ends the sharing: the code they joined by is spent
            stopSharing()
          }
        },
        reachableAt,
      })
      ;({ connection } = host)
      const offer = await host.offer()
      if (stopped) {
        return
      }
      invitation = await parts.invite({ controls, core, offer, platform, title }, listed)
      if (stopped) {
        await invitation.withdraw()
        // Its answer, which can no longer come, is let go
        await attemptAsync(async () => await invitation?.answer)
        return
      }
      set({ code: invitation.code, listed, stage: 'inviting' })
      const answered = await invitation.answer
      if (stopped) {
        return
      }
      guest = answered.guest || undefined
      await host.accept(answered.answer)
    } catch {
      fail()
    }
  }

  return { getSharing, getSharingConnection, startSharing, stopSharing, subscribeSharing }
}

export const { getSharing, getSharingConnection, startSharing, stopSharing, subscribeSharing } = createSharing({
  getOwnAddress,
  hostGame,
  invite,
  isListed: () => !joinCodeSwitch.isEnabled(),
})
