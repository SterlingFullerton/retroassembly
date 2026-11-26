import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultPreference } from '#@/constants/preference.ts'
import { getKeyButtons, mergePads, standardButton } from '#@/input/guest-pad.ts'
import { retroPadButtons } from '#@/input/retropad.ts'

function heldIn(pad: { buttons: { pressed: boolean }[] }) {
  return pad.buttons.map((button, index) => (button.pressed ? index : -1)).filter((index) => index >= 0)
}

function source(pressed: number[], axes?: number[]) {
  return { axes, buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })) }
}

await describe('a guest’s controller', async () => {
  await it('has a place on a standard gamepad for each of the emulator’s buttons, no two the same', () => {
    assert.deepEqual(Object.keys(standardButton).toSorted(), [...retroPadButtons].toSorted())
    assert.equal(new Set(Object.values(standardButton)).size, retroPadButtons.length)
  })

  await it('reads the keys for the game’s buttons from the keyboard settings', () => {
    const keys = getKeyButtons({
      $pause: 'escape',
      input_player1_a: 'x',
      input_player1_l_x_minus: 'j',
      input_player1_l1: 'q',
      input_player1_start: 'enter',
      input_player1_up: 'up',
      input_player1_y: '',
    })
    assert.deepEqual(Object.fromEntries(keys), { enter: 'start', q: 'l', up: 'up', x: 'a' })
  })

  await it('gives the default keyboard a key for the buttons a game is played with', () => {
    const buttons = new Set(getKeyButtons(defaultPreference.input.keyboardMapping).values())
    for (const button of ['a', 'b', 'x', 'y', 'l', 'r', 'start', 'select', 'up', 'down', 'left', 'right'] as const) {
      assert.ok(buttons.has(button), button)
    }
  })

  await it('holds every button any way of playing holds', () => {
    const pad = mergePads(['a', 'start'], [source([0, 12]), null, source([12, 5])])
    assert.deepEqual(heldIn(pad), [0, 1, 5, 9, 12])
    assert.deepEqual(heldIn(mergePads([], [])), [])
    assert.equal(mergePads([], []).buttons.length, 17)
  })

  await it('takes each stick axis from the first way of playing that pushes it', () => {
    const pad = mergePads([], [source([], [0.05, -0.8, 0, 0]), source([], [0.6, 0.3, 0, -1])])
    assert.deepEqual(pad.axes, [0.6, -0.8, 0, -1])
  })

  await it('leaves a stick at rest when nothing pushes it past a tenth', () => {
    assert.deepEqual(mergePads([], [source([], [0.09, -0.09, 0, 0])]).axes, [0, 0, 0, 0])
    assert.deepEqual(mergePads([], [undefined, {}]).axes, [0, 0, 0, 0])
  })
})
