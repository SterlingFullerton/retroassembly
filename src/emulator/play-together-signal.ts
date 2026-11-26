import { client, parseResponse } from '#@/api/client.ts'

// How a host and a guest swap the two pieces of text that let their browsers find each other: through the server,
// behind a short code. The host leaves an invitation and is given the code, which they tell the guest; the guest finds
// the invitation by it and leaves their answer, which the host collects. After that the server has no part

/** What a host hands a guest: how to reach the game, and what it is */
export interface Invitation {
  /** The console's on-screen controls, by name, for a guest on a touch screen */
  controls: string
  /** The host's offer */
  offer: string
  /** The game's name */
  title: string
}

/**
 * Leaves `invitation` for a guest. `code` is what the guest joins by, and `answer` is their answer once they have; it
 * never comes if `withdraw()` is called first, which also takes the invitation back
 */
export async function invite(invitation: Invitation) {
  const { code } = await parseResponse(client.play_together.invitations.$post({ json: invitation }))
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
