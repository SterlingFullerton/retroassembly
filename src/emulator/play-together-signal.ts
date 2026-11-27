import { client, parseResponse } from '#@/api/client.ts'

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

/**
 * Leaves `invitation` for a guest. Listed, it's shown to everyone signed in; otherwise only its code finds it. `code` is what the guest joins by, and `answer` is their answer once they have; it
 * never comes if `withdraw()` is called first, which also takes the invitation back
 */
export async function invite(invitation: Invitation, listed: boolean) {
  const { code } = await parseResponse(client.play_together.invitations.$post({ json: { ...invitation, listed } }))
  const param = { code }
  const stop = new AbortController()

  async function waitForAnswer() {
    // The server keeps each request waiting a while for the answer, then says to ask again
    while (!stop.signal.aborted) {
      const answered = await parseResponse(
        client.play_together.invitations[':code'].answer.$get({ param }, { init: { signal: stop.signal } }),
      )
      if (answered) {
        return answered.answer
      }
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
      await parseResponse(client.play_together.invitations[':code'].answer.$post({ json: { answer: text }, param }))
    },
    invitation,
  }
}
