import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodePadState,
  encodePadState,
  padButtonCount,
  padStateSize,
  withReachableAddress,
} from '#@/emulator/play-together.ts'

function pad(pressed: number[] = [], axes = [0, 0, 0, 0]) {
  return {
    axes,
    buttons: Array.from({ length: padButtonCount }, (_, index) => {
      const down = pressed.includes(index)
      return { pressed: down, touched: down, value: down ? 1 : 0 }
    }),
  }
}

function sent(from: ReturnType<typeof pad>) {
  const to = pad()
  assert.ok(decodePadState(encodePadState(from), to))
  return to
}

await describe('a controller sent across the network', async () => {
  await it('is seven bytes', () => {
    assert.equal(padStateSize, 7)
    assert.equal(encodePadState(pad()).length, 7)
    assert.deepEqual([...encodePadState(pad())], [0, 0, 0, 0, 0, 0, 0])
  })

  await it('arrives with the same buttons held, every one of them', () => {
    for (let index = 0; index < padButtonCount; index += 1) {
      const arrived = sent(pad([index]))
      assert.deepEqual(
        arrived.buttons.map((button) => button.pressed),
        pad([index]).buttons.map((button) => button.pressed),
        `button ${index}`,
      )
      assert.deepEqual(arrived.buttons[index], { pressed: true, touched: true, value: 1 })
    }
    const several = [0, 3, 8, 9, 12, 16]
    assert.deepEqual(
      sent(pad(several))
        .buttons.map((button, index) => (button.pressed ? index : -1))
        .filter((index) => index >= 0),
      several,
    )
  })

  await it('lets go of buttons that were held before', () => {
    const to = pad([1, 2, 3])
    decodePadState(encodePadState(pad([2])), to)
    assert.deepEqual(to.buttons.map((button) => button.pressed).filter(Boolean).length, 1)
    assert.ok(to.buttons[2].pressed)
  })

  await it('arrives with its sticks where they were, to within a hundredth', () => {
    const arrived = sent(pad([], [-1, 1, 0.5, -0.25]))
    assert.equal(arrived.axes[0], -1)
    assert.equal(arrived.axes[1], 1)
    assert.ok(Math.abs(arrived.axes[2] - 0.5) < 0.01)
    assert.ok(Math.abs(arrived.axes[3] + 0.25) < 0.01)
    assert.deepEqual(sent(pad()).axes, [0, 0, 0, 0])
  })

  await it('keeps a stick pushed too far, or not there at all, within its range', () => {
    assert.deepEqual(sent(pad([], [5, -5, Number.NaN, 0])).axes.slice(0, 2), [1, -1])
    const short = { axes: [0.5], buttons: [{ pressed: true }] }
    const to = pad()
    decodePadState(encodePadState(short), to)
    assert.ok(to.buttons[0].pressed)
    assert.deepEqual(to.axes.slice(1), [0, 0, 0])
  })

  // The same bytes are fed to the game service's pad in nas-games/pad_test.go: a change on either side fails one
  // of them
  await it('with a stylus, is these twelve bytes', () => {
    const golden = [1, 2, 1, 127, 129, 64, 0, 0, 64, 255, 255, 1]
    assert.deepEqual([...encodePadState(pad([0, 9, 16], [1, -1, 0.5, 0]), { down: true, x: 0.25, y: 1 })], golden)
  })

  await it('with a stylus, is ignored by a person’s game, which takes none', () => {
    const to = pad([4], [0.5, 0, 0, 0])
    const withStylus = encodePadState(pad([1]), { down: true, x: 0.5, y: 0.5 })
    assert.equal(decodePadState(withStylus, to), false)
    assert.deepEqual(to, pad([4], [0.5, 0, 0, 0]))
  })

  await it('is ignored when it’s the wrong length, leaving the controller as it was', () => {
    const to = pad([4])
    assert.equal(decodePadState(new Uint8Array(3), to), false)
    assert.equal(decodePadState(new Uint8Array(20), to), false)
    assert.ok(to.buttons[4].pressed)
  })
})

await describe('a browser’s description, with the address the server sees it at', async () => {
  const hidden =
    'a=candidate:842163049 1 udp 2113937151 0d4b1c8e-7a2f-4e1b-9c5d-1f2e3a4b5c6d.local 54321 typ host generation 0'
  const sdp = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', hidden, 'a=end-of-candidates', ''].join('\r\n')

  await it('offers each way in again at that address, on the same port', () => {
    const lines = withReachableAddress(sdp, '100.92.0.118').split('\r\n')
    assert.deepEqual(lines, [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      hidden,
      'a=candidate:8421630499 1 udp 2113937151 100.92.0.118 54321 typ host generation 0',
      'a=end-of-candidates',
      '',
    ])
  })

  await it('is left alone with no address, or when the address is already offered', () => {
    assert.equal(withReachableAddress(sdp, ''), sdp)
    const open = sdp.replace('0d4b1c8e-7a2f-4e1b-9c5d-1f2e3a4b5c6d.local', '100.92.0.118')
    assert.equal(withReachableAddress(open, '100.92.0.118'), open)
    const both = withReachableAddress(sdp, '100.92.0.118')
    assert.equal(withReachableAddress(both, '100.92.0.118'), both)
  })

  await it('adds the address once for each port, and only for ways in over UDP', () => {
    const second = 'a=candidate:1 1 udp 2113939711 fe80--1.local 60000 typ host generation 0'
    const repeat = 'a=candidate:3 1 udp 2113937000 another-name.local 54321 typ host generation 0'
    const tcp = 'a=candidate:2 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 0'
    const relayed = 'a=candidate:4 1 udp 1677729535 203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0 generation 0'
    const several = ['v=0', hidden, second, repeat, tcp, relayed, ''].join('\r\n')
    const added = withReachableAddress(several, '100.92.0.118')
      .split('\r\n')
      .filter((line) => line.includes(' 100.92.0.118 '))
    assert.deepEqual(
      added.map((line) => line.split(' ')[5]),
      ['54321', '60000'],
    )
  })
})
