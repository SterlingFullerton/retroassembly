import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveConsole } from '#@/consoles/registry.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { buildInputConfig } from '#@/input/build-input-config.ts'
import { bindConsoleKey, getConsoleKeys, getHotkeyOn, getOwnKeySettings } from '#@/input/console-keys.ts'
import { getPadKeys } from '#@/input/pad.ts'

const shared: Record<string, string> = defaultPreference.input.keyboardMapping
const n64 = resolveConsole('n64', 'mupen64plus_next')
const gbc = resolveConsole('gbc', 'mgba')

function launchSettings(console: typeof n64, ownKeys?: Record<string, string>) {
  return buildInputConfig({ console, gamepad: {}, keyboard: shared, ownKeys, remapDirectory: '', touch: false })
    .retroarchConfig
}

await describe('a console’s own keys', async () => {
  await it('starts from the shared layout as the console moves it', () => {
    const keys = getConsoleKeys(n64, shared)
    // The N64's Z and C buttons get keys the shared layout doesn't have, and the arrows move to its stick
    assert.equal(keys.input_player1_l2, 'e')
    assert.equal(keys.input_player1_r_y_minus, 'i')
    assert.equal(keys.input_player1_l_y_minus, 'up')
    assert.equal(keys.input_player1_up, 't')
    assert.equal(getConsoleKeys(gbc, shared).input_player1_a, 'x')
  })

  await it('keeps only what differs, and gives a key to one button at a time', () => {
    const own = bindConsoleKey({ console: n64, shared }, 'b', 'e')
    // E was Z's (L2): Z loses it
    assert.deepEqual(own, { input_player1_b: 'e', input_player1_l2: '' })
    const keys = getConsoleKeys(n64, shared, own)
    assert.equal(keys.input_player1_b, 'e')
    assert.equal(keys.input_player1_l2, '')
  })

  await it('forgets a button that’s given its default key back', () => {
    const own = bindConsoleKey({ console: gbc, shared }, 'a', 'p')
    assert.deepEqual(own, { input_player1_a: 'p' })
    assert.deepEqual(bindConsoleKey({ console: gbc, own, shared }, 'a', 'x'), {})
  })

  await it('can leave a button without a key', () => {
    assert.deepEqual(bindConsoleKey({ console: gbc, shared }, 'select', ''), { input_player1_select: '' })
  })

  await it('reaches the game over the shared layout and the console’s own moves', () => {
    assert.equal(launchSettings(n64).input_player1_l2, 'e')
    const settings = launchSettings(n64, { input_player1_l2: 'p', input_player1_up: '' })
    assert.equal(settings.input_player1_l2, 'p')
    assert.equal(settings.input_player1_up, '')
    // The rest are as they were
    assert.equal(settings.input_player1_r_y_minus, 'i')
    assert.equal(settings.input_player1_b, launchSettings(n64).input_player1_b)
  })

  await it('ignores stored settings that aren’t a button’s key', () => {
    const own = { input_player1_a: 'p', input_rewind: 'x', video_smooth: 'true' }
    assert.deepEqual(getOwnKeySettings(gbc, shared, own), { input_player1_a: 'p' })
  })

  await it('says when a key already pauses, rewinds or fast-forwards', () => {
    assert.equal(getHotkeyOn(shared, shared.$pause), '$pause')
    assert.equal(getHotkeyOn(shared, 'p'), undefined)
    assert.equal(getHotkeyOn(shared, ''), undefined)
  })

  await it('shows on the controller, every button listed for the settings', () => {
    const own = { input_player1_l2: 'p' }
    const played = getPadKeys(n64, shared, { own })
    assert.equal(played.shoulders.left.find(({ label }) => label === 'Z')?.key, 'P')
    const edited = getPadKeys(n64, shared, { edit: true, own })
    const z = edited.shoulders.left.find(({ label }) => label === 'Z')
    assert.deepEqual(z, { changed: true, input: 'l2', key: 'P', label: 'Z' })
    assert.equal(edited.shoulders.left.find(({ label }) => label === 'L')?.changed, false)
    // A button without a key is still there to be given one
    const cleared = getPadKeys(gbc, shared, { edit: true, own: { input_player1_select: '' } })
    assert.deepEqual(cleared.center[0], { changed: true, input: 'select', key: '', label: 'Select' })
    assert.equal(getPadKeys(gbc, shared, { own: { input_player1_select: '' } }).center.length, 1)
  })
})
