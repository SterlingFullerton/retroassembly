import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultPreference } from '#@/constants/preference.ts'
import {
  getColecoVisionKeyboard,
  getCoreKeyboardConfig,
  getGenesisKeyboard,
} from '#@/pages/library/utils/core-keyboard.ts'

const defaults = defaultPreference.input.keyboardMapping as Record<string, string>

await describe('ColecoVision keys', async () => {
  await it('puts the keypad on the number keys', () => {
    const { config, keys } = getColecoVisionKeyboard(defaults)
    assert.equal(config.input_player1_y, 'num1')
    assert.equal(config.input_player1_l, 'num3')
    assert.equal(config.input_player1_r3, 'num8')
    assert.equal(config.input_player1_l_y_plus, 'num9')
    assert.equal(config.input_player1_l_x_plus, 'num0')
    for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      assert.equal(keys.keypad[label], `num${label}`)
    }
  })

  await it('keeps the joystick and the left stick apart, so 9 and 0 are only keys', () => {
    const { config } = getColecoVisionKeyboard(defaults)
    assert.equal(config.input_player1_analog_dpad_mode, 0)
    assert.equal(config.input_player1_l_x_minus, '')
    assert.equal(config.input_player1_l_y_minus, '')
  })

  await it("leaves a keypad key on its usual key when its number key is the player's for something else", () => {
    const { config, keys } = getColecoVisionKeyboard({ ...defaults, input_player1_a: 'num2' })
    assert.equal(config.input_player1_x, 's')
    assert.equal(keys.keypad['2'], 's')
    assert.equal(config.input_player1_y, 'num1')
  })

  await it('only applies to the ColecoVision emulator', () => {
    assert.deepEqual(getCoreKeyboardConfig('fceumm', defaults), {})
    assert.equal(getCoreKeyboardConfig('gearcoleco', defaults).input_player1_x, 'num2')
  })
})

await describe('Genesis keys', async () => {
  await it('puts A B C on Z X C and X Y Z on A S D while the keys are the defaults', () => {
    const { config, keys } = getGenesisKeyboard(defaults)
    assert.deepEqual(keys, { A: 'z', B: 'x', C: 'c', X: 'a', Y: 's', Z: 'd' })
    assert.equal(config.input_player1_y, 'z')
    assert.equal(config.input_player1_a, 'c')
    assert.equal(config.input_player1_l, 'a')
    assert.equal(config.input_player1_r, 'd')
  })

  await it("keeps the player's own keys", () => {
    const { config, keys } = getGenesisKeyboard({ ...defaults, input_player1_b: 'k' })
    assert.deepEqual(config, {})
    assert.equal(keys.B, 'k')
    assert.equal(keys.A, 'a')
  })

  await it('leaves the keys alone when a new one is used for something else', () => {
    assert.deepEqual(getGenesisKeyboard({ ...defaults, input_rewind: 'c' }).config, {})
  })

  await it('only applies to Genesis games, not the Game Gear or Master System on the same emulator', () => {
    assert.equal(getCoreKeyboardConfig('genesis_plus_gx', defaults, 'genesis').input_player1_y, 'z')
    assert.equal(getCoreKeyboardConfig('genesis_plus_gx', defaults, 'megadrive').input_player1_y, 'z')
    assert.deepEqual(getCoreKeyboardConfig('genesis_plus_gx', defaults, 'gamegear'), {})
    assert.deepEqual(getCoreKeyboardConfig('genesis_plus_gx', defaults, 'sms'), {})
  })
})
