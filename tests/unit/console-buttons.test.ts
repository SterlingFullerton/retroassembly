import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveConsole } from '#@/consoles/registry.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { buildInputConfig } from '#@/input/build-input-config.ts'
import {
  bindConsoleButton,
  gamepadButtonName,
  getConsoleButtons,
  getOwnButtonSettings,
} from '#@/input/console-buttons.ts'
import { getPadButtons } from '#@/input/pad.ts'

// A gamepad's layout as the app keeps it, where the shoulders are L1 and R1
const gamepad = {
  $pause: 'L1 + R1',
  input_player1_a_btn: '1',
  input_player1_b_btn: '0',
  input_player1_l1_btn: '4',
  input_player1_l2_btn: '6',
  input_player1_r1_btn: '5',
  input_player1_select_btn: '8',
  input_player1_start_btn: '9',
  input_player1_up_btn: '12',
  input_player1_x_btn: '3',
  input_player1_y_btn: '2',
}
const n64 = resolveConsole('n64', 'mupen64plus_next')

await describe('a console’s own gamepad buttons', async () => {
  await it('starts from the gamepad’s layout, under RetroArch’s names', () => {
    const buttons = getConsoleButtons(gamepad)
    assert.equal(buttons.input_player1_a_btn, '1')
    assert.equal(buttons.input_player1_l_btn, '4')
    // One the layout leaves out has none
    assert.equal(buttons.input_player1_r3_btn, 'nul')
  })

  await it('keeps only what differs, and gives a gamepad button to one button at a time', () => {
    const own = bindConsoleButton({ gamepad }, 'b', '1')
    // 1 was A's: A loses it
    assert.deepEqual(own, { input_player1_a_btn: 'nul', input_player1_b_btn: '1' })
    assert.deepEqual(bindConsoleButton({ gamepad, own }, 'b', '0'), { input_player1_a_btn: 'nul' })
    assert.deepEqual(bindConsoleButton({ gamepad, own: { input_player1_b_btn: '7' } }, 'b', '0'), {})
  })

  await it('can leave a button without one', () => {
    assert.deepEqual(bindConsoleButton({ gamepad }, 'select', ''), { input_player1_select_btn: 'nul' })
  })

  await it('reaches the game over the gamepad’s layout', () => {
    const options = {
      console: n64,
      gamepad,
      keyboard: defaultPreference.input.keyboardMapping,
      remapDirectory: '',
      touch: false,
    }
    assert.equal(buildInputConfig(options).retroarchConfig.input_player1_l2_btn, '6')
    const { retroarchConfig } = buildInputConfig({ ...options, ownButtons: { input_player1_l2_btn: '5' } })
    assert.equal(retroarchConfig.input_player1_l2_btn, '5')
    assert.equal(retroarchConfig.input_player1_b_btn, '0')
  })

  await it('ignores stored settings that aren’t a button’s', () => {
    const own = { input_player1_a_btn: '7', input_rewind_btn: '3', video_smooth: 'true' }
    assert.deepEqual(getOwnButtonSettings(gamepad, own), { input_player1_a_btn: '7' })
  })

  await it('names a gamepad’s buttons by their place', () => {
    assert.deepEqual(gamepadButtonName('4'), { key: 'L1' })
    assert.ok(gamepadButtonName('0').icon)
    assert.deepEqual(gamepadButtonName('23'), { key: '#23' })
    assert.deepEqual(gamepadButtonName('nul'), { key: '' })
  })

  await it('shows on the controller, with the sticks as the gamepad’s own', () => {
    const pad = getPadButtons(n64, gamepad, { edit: true, own: { input_player1_l2_btn: '5' } })
    assert.deepEqual(
      pad.shoulders.left.find(({ label }) => label === 'Z'),
      { changed: true, input: 'l2', key: 'R1', label: 'Z' },
    )
    assert.equal(pad.moves[0].stick, 'L')
    assert.equal(pad.moves[0].inputs, undefined)
    assert.equal(pad.moves[1].up, '↑')
    assert.equal(pad.rightCluster?.stick, 'R')
  })
})
