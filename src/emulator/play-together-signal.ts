import { attemptAsync } from 'es-toolkit'
import { client, parseResponse } from '#@/api/client.ts'
import { DetailedError } from '#@/api/request.ts'

// How a host and a guest swap the two pieces of text that let their browsers find each other: through the server,
// behind a short code. The host leaves an invitation and is given the code, which they tell the guest; the guest finds
// the invitation by it and leaves their answer, which the host collects. After that the server has no part

/** What a host hands a guest: how to reach the game, and what it is */
export interface Invitation {
  /** The console's on-screen controls, by name, for a guest on a touch screen */
  controls: string
  /** The emulator the game is played with, and its console: the guest's keys are the ones they'd play it with */
  core?: string
  /** The host's name */
  host?: string
  /** The host's offer */
  offer: string
  platform?: string
  /** The game's name */
  title: string
  /** A console of a linked pair on the server, which has no snapshots */
  linked?: boolean
  /** For the starter's console of a linked pair, the code that joins the friend's */
  friendCode?: string
  /** For a game on the server, the place in it kept for this browser, which its answer is for */
  place?: string
  /** A game on the server that the player looking it up started, who can end it */
  startedHere?: boolean
}

/**
 * The address this browser reaches the server from, which the other browser can probably reach it at too; '' when the
 * server can't say
 */
export async function getOwnAddress() {
  try {
    const { address } = await parseResponse(client.play_together.address.$get())
    return address
  } catch {
    return ''
  }
}

/** A game anyone signed in may join: what it is, whose, and the code that joins it */
export type OpenGame = Awaited<ReturnType<typeof listOpenGames>>[number]

/** The games being shared that anyone signed in may join without being told a code */
export function listOpenGames() {
  return parseResponse(client.play_together.invitations.$get())
}

/** A guest's answer to an invitation, and the username of whoever sent it, when the server says */
export interface Answer {
  answer: string
  guest?: string
}

// How long to wait before asking for the answer again after asking failed, longer each time it fails in a row
const retryDelays = [1000, 2000, 5000]

function isPassingStatus(status: number) {
  return status >= 500 || status === 408 || status === 429
}

/**
 * Whether asking again could go better: the request never got an answer, or what's in front of the server answered for
 * it while it restarts. The server's own failure, such as there being no invitation by that code, is final
 */
function isPassing(error: unknown) {
  if (error instanceof TypeError) {
    return true
  }
  if (error instanceof Response) {
    return isPassingStatus(error.status)
  }
  return error instanceof DetailedError && isPassingStatus(error.statusCode)
}

/** Waits `ms`, or less if the page is shown again meanwhile, or not at all once `signal` is aborted */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = new AbortController()
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      done.abort()
      resolve()
    }
    signal.addEventListener('abort', finish, { signal: done.signal })
    globalThis.document?.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          finish()
        }
      },
      { signal: done.signal },
    )
  })
}

/**
 * Leaves `invitation` for a guest. Listed, it's shown to everyone signed in; otherwise only its code finds it. `code`
 * is what the guest joins by, and `answer` is their answer once they have; it never comes if `withdraw()` is called
 * first, which also takes the invitation back
 */
export async function invite(invitation: Invitation, listed: boolean) {
  const { code } = await parseResponse(client.play_together.invitations.$post({ json: { ...invitation, listed } }))
  const param = { code }
  const stop = new AbortController()

  async function waitForAnswer(): Promise<Answer> {
    // The server keeps each request waiting a while for the answer, then says to ask again. A request that fails, as
    // one does while a phone has the page in the background to send the code, is made again: only the server no longer
    // having the invitation, its time over, ends the wait
    let failures = 0
    while (!stop.signal.aborted) {
      const [error, answered] = await attemptAsync(() =>
        parseResponse(
          client.play_together.invitations[':code'].answer.$get({ param }, { init: { signal: stop.signal } }),
        ),
      )
      if (answered) {
        return answered
      }
      if (!error) {
        failures = 0
        continue
      }
      if (stop.signal.aborted || !isPassing(error)) {
        throw error
      }
      await pause(retryDelays[Math.min(failures, retryDelays.length - 1)], stop.signal)
      failures += 1
    }
    throw new Error('The invitation was withdrawn')
  }

  return {
    answer: waitForAnswer(),
    code,
    async withdraw() {
      stop.abort()
      try {
        await parseResponse(client.play_together.invitations[':code'].$delete({ param }))
      } catch {
        // Already gone: collected, or forgotten after its time
      }
    },
  }
}

/** The invitation left under `code`, and a way to answer it. Throws when there's none by that code */
export async function findInvitation(code: string) {
  const param = { code: code.replaceAll(/\s/gu, '').toUpperCase() }
  const invitation: Invitation = await parseResponse(client.play_together.invitations[':code'].$get({ param }))
  return {
    async answer(text: string) {
      const { place } = invitation
      await parseResponse(
        client.play_together.invitations[':code'].answer.$post({ json: { answer: text, place }, param }),
      )
    },
    invitation,
  }
}
