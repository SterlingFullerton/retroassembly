import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { noop } from 'es-toolkit'
import type { Nostalgist } from 'nostalgist'
import { createSharing, type ShareOptions, type SharingParts } from '#@/emulator/play-together-session.ts'
import { type Answer, invite } from '#@/emulator/play-together-signal.ts'
import type { HostOptions } from '#@/emulator/play-together.ts'

/** A promise and the means to settle it from outside */
function deferred<T>() {
  return Promise.withResolvers<T>()
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// Sharing with stand-ins for the network and the emulator, each step held until the test lets it go
function fakeParts() {
  const address = deferred<string>()
  const invited = deferred<undefined>()
  const hosts: { closed: boolean; onGuest: NonNullable<HostOptions['onGuest']>; accepted?: string }[] = []
  const invitations: { answer: ReturnType<typeof deferred<Answer>>; withdrawn: boolean }[] = []
  const parts: SharingParts = {
    getOwnAddress: () => address.promise,
    hostGame(options) {
      const host = { closed: false, onGuest: options.onGuest ?? noop } as (typeof hosts)[number]
      hosts.push(host)
      return {
        accept(answer: string) {
          host.accepted = answer
          return Promise.resolve()
        },
        close() {
          host.closed = true
        },
        connection: {} as RTCPeerConnection,
        offer: () => Promise.resolve('offer'),
      }
    },
    async invite() {
      await invited.promise
      const invitation = { answer: deferred<Answer>(), withdrawn: false }
      invitations.push(invitation)
      return {
        answer: invitation.answer.promise,
        code: `CODE${invitations.length}`,
        withdraw() {
          invitation.withdrawn = true
          invitation.answer.reject(new Error('withdrawn'))
          return Promise.resolve()
        },
      }
    },
    isListed: () => false,
  }
  return { address, hosts, invitations, invited, parts }
}

const game = {
  controls: 'snes',
  core: 'snes9x',
  emulator: { getCanvas: () => ({}) } as unknown as Nostalgist,
  platform: 'snes',
  title: 'A game',
} satisfies ShareOptions

await describe('sharing a game', async () => {
  await it('shows the code, then who joined and as which player', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    assert.deepEqual(sharing.getSharing(), { code: 'CODE1', listed: false, stage: 'inviting' })
    invitations[0].answer.resolve({ answer: 'answer', guest: 'sam' })
    await started
    assert.equal(hosts[0].accepted, 'answer')
    hosts[0].onGuest(true, 2)
    assert.deepEqual(sharing.getSharing(), { guest: 'sam', player: 2, stage: 'connected' })
  })

  await it('still says a guest joined when the server doesn’t say who', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    invitations[0].answer.resolve({ answer: 'answer' })
    await started
    hosts[0].onGuest(true, 3)
    assert.deepEqual(sharing.getSharing(), { guest: undefined, player: 3, stage: 'connected' })
  })

  await it('makes nothing when stopped while it asks for its address', async () => {
    const { address, hosts, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    sharing.stopSharing()
    address.resolve('')
    await started
    assert.equal(hosts.length, 0)
    assert.equal(sharing.getSharing().stage, 'idle')
  })

  await it('takes the invitation back when stopped before it was made', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    await flush()
    sharing.stopSharing()
    invited.resolve(undefined)
    await started
    assert.equal(hosts[0].closed, true)
    assert.equal(invitations[0].withdrawn, true)
    assert.equal(sharing.getSharing().stage, 'idle')
  })

  await it('can invite again when the guest answered but was never reached', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    invitations[0].answer.resolve({ answer: 'answer' })
    await started
    hosts[0].onGuest(false)
    assert.equal(sharing.getSharing().stage, 'failed')
    assert.equal(hosts[0].closed, true)
  })

  await it('ends when a guest who joined leaves', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    invitations[0].answer.resolve({ answer: 'answer' })
    await started
    hosts[0].onGuest(true, 2)
    hosts[0].onGuest(false)
    assert.equal(sharing.getSharing().stage, 'idle')
    assert.equal(sharing.getSharingConnection(), undefined)
  })

  await it('fails when the invitation is lost while it waits for an answer', async () => {
    const { address, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const started = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    invitations[0].answer.reject(new Error('gone'))
    await started
    assert.equal(sharing.getSharing().stage, 'failed')
  })

  await it('keeps a new sharing when the one it replaced hears its guest leave', async () => {
    const { address, hosts, invitations, invited, parts } = fakeParts()
    const sharing = createSharing(parts)
    const first = sharing.startSharing(game)
    address.resolve('')
    invited.resolve(undefined)
    await flush()
    invitations[0].answer.resolve({ answer: 'answer' })
    await first
    hosts[0].onGuest(true, 2)

    const second = sharing.startSharing(game)
    await flush()
    // The first guest's connection, closing, says they left
    hosts[0].onGuest(false)
    assert.deepEqual(sharing.getSharing(), { code: 'CODE2', listed: false, stage: 'inviting' })
    assert.equal(invitations[1].withdrawn, false)
    sharing.stopSharing()
    await second
  })
})

await describe('waiting for a guest’s answer', async () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  await it('asks again after no answer yet, and after a request that failed', async () => {
    const answers: (() => Response)[] = [
      () => json(null),
      () => {
        throw new TypeError('Load failed')
      },
      () => json({ answer: 'answer', guest: 'sam' }),
    ]
    // oxlint-disable-next-line typescript/require-await -- a failed request is a rejection, as fetch's is
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({ code: 'CODE' })
      }
      const next = answers.shift()
      assert.ok(next, `unexpected request to ${String(input)}`)
      return next()
    }
    const invitation = await invite({ controls: 'snes', offer: 'offer', title: 'A game' }, false)
    assert.deepEqual(await invitation.answer, { answer: 'answer', guest: 'sam' })
    assert.equal(answers.length, 0)
  })

  await it('stops when the server no longer has the invitation', async () => {
    globalThis.fetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? json({ code: 'CODE' }) : json({ message: 'Not found' }, 404))
    const invitation = await invite({ controls: 'snes', offer: 'offer', title: 'A game' }, false)
    await assert.rejects(invitation.answer)
  })
})
