import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveConsole } from '#@/consoles/registry.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { buildInputConfig } from '#@/input/build-input-config.ts'
import { bindHotkey, bindNavigationKey, getNavigationKeys, playsGameButton } from '#@/input/navigation-keys.ts'

const shared: Record<string, string> = defaultPreference.input.keyboardMapping

await describe('the library’s own keys', async () => {
  await it('start out as the shared layout’s, Confirm and Cancel by the button style', () => {
    assert.deepEqual(getNavigationKeys(shared, 'nintendo'), {
      $cancel: shared.input_player1_b,
      $confirm: shared.input_player1_a,
      $down: 'down',
      $left: 'left',
      $right: 'right',
      $up: 'up',
    })
    assert.equal(getNavigationKeys(shared, 'xbox').$confirm, shared.input_player1_b)
  })

  await it('are their own once set, and can be none', () => {
    const keys = getNavigationKeys({ ...shared, $cancel: '', $confirm: 'c' }, 'nintendo')
    assert.equal(keys.$confirm, 'c')
    assert.equal(keys.$cancel, '')
  })

  await it('take a key from another of them, never from a game button', () => {
    const keys = getNavigationKeys(shared, 'nintendo')
    assert.deepEqual(bindNavigationKey(keys, '$confirm', keys.$cancel), { $cancel: '', $confirm: keys.$cancel })
    assert.deepEqual(bindNavigationKey(keys, '$up', 'w'), { $up: 'w' })
  })

  await it('never reach the emulator', () => {
    const { retroarchConfig } = buildInputConfig({
      console: resolveConsole('gbc', 'mgba'),
      gamepad: {},
      keyboard: { ...shared, $confirm: 'c', $up: 'w' },
      remapDirectory: '',
      touch: false,
    })
    assert.deepEqual(
      Object.keys(retroarchConfig).filter((name) => name.startsWith('$')),
      [],
    )
    assert.equal(retroarchConfig.input_player1_up, 'up')
  })
})

await describe('the keys that pause, rewind and fast-forward', async () => {
  await it('can’t be a key that plays a game button', () => {
    assert.equal(playsGameButton(shared, shared.input_player1_a), true)
    assert.equal(playsGameButton(shared, 'p'), false)
    // Another shortcut's key isn't a game button's
    assert.equal(playsGameButton(shared, shared.input_rewind), false)
    assert.equal(playsGameButton(shared, ''), false)
  })

  await it('can’t be a key a console’s own buttons have', () => {
    assert.equal(playsGameButton(shared, 'p', { snes: { input_player1_a: 'p' } }), true)
    assert.equal(playsGameButton(shared, 'p', { gba: null, snes: { input_player1_a: 'o' } }), false)
  })

  await it('take a key from another shortcut', () => {
    assert.deepEqual(bindHotkey(shared, 'input_rewind', shared.$pause), { $pause: '', input_rewind: shared.$pause })
    assert.deepEqual(bindHotkey(shared, '$pause', 'p'), { $pause: 'p' })
  })
})
