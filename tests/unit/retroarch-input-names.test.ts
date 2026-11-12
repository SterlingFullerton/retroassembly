import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toRetroarchInputNames } from '#@/utils/isomorphic/retroarch-input-names.ts'

await describe('RetroArch input names', async () => {
  await it('renames L1 and R1 to l and r, for keys and controller buttons', () => {
    assert.deepEqual(
      toRetroarchInputNames({
        input_player1_l1: 'o',
        input_player1_l1_btn: '6',
        input_player1_r1: 'p',
        input_player1_r1_btn: '7',
      }),
      { input_player1_l: 'o', input_player1_l_btn: '6', input_player1_r: 'p', input_player1_r_btn: '7' },
    )
  })

  await it('leaves every other setting alone', () => {
    const mapping = {
      $pause: 'escape',
      input_hold_fast_forward: 'space',
      input_player1_a: 'x',
      input_player1_l2: 'e',
      input_player1_l2_btn: '6',
      input_player1_l3: '',
      input_player1_r_x_minus: '',
    }
    assert.deepEqual(toRetroarchInputNames(mapping), mapping)
  })
})
