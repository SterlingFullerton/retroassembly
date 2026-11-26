import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodePadState, encodePadState, padButtonCount, padStateSize } from '#@/emulator/play-together.ts'

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

  await it('is ignored when it’s the wrong length, leaving the controller as it was', () => {
    const to = pad([4])
    assert.equal(decodePadState(new Uint8Array(3), to), false)
    assert.equal(decodePadState(new Uint8Array(20), to), false)
    assert.ok(to.buttons[4].pressed)
  })
})
