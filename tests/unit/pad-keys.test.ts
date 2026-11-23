import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { consoles, resolveConsole } from '#@/consoles/registry.ts'
import { defaultPreference } from '#@/constants/preference.ts'
import { getPadKeys } from '#@/input/pad.ts'

const mapping: Record<string, string> = defaultPreference.input.keyboardMapping

function padKeys(platform: string, core: string, keyboard = mapping) {
  return getPadKeys(resolveConsole(platform, core), keyboard)
}

await describe('the keys on a console’s controller', async () => {
  await it('shows a Game Boy as its d-pad, B, A, Select and Start', () => {
    assert.deepEqual(padKeys('gbc', 'mgba'), {
      center: [
        { key: 'Right Shift', label: 'Select' },
        { key: 'Enter', label: 'Start' },
      ],
      face: [
        [
          { color: '#e05a95', key: 'Z', label: 'B' },
          { color: '#e05a95', key: 'X', label: 'A' },
        ],
      ],
      leftGroup: undefined,
      moves: [{ down: '↓', label: 'D-pad', left: '←', right: '→', up: '↑' }],
      rightCluster: undefined,
      rightGroup: undefined,
      shoulders: { left: [], right: [] },
    })
  })

  await it('shows a PlayStation’s symbols in a diamond, without the triggers that have no key', () => {
    const { face, shoulders } = padKeys('psx', 'pcsx_rearmed')
    assert.deepEqual(
      face.map((row) => row.map(({ key, label }) => `${label}=${key}`)),
      [['△=S'], ['□=A', '○=X'], ['✕=Z']],
    )
    assert.deepEqual(shoulders, { left: [{ key: 'Q', label: 'L1' }], right: [{ key: 'W', label: 'R1' }] })
  })

  await it('gives the N64 its stick on the arrows, and the D-pad, C buttons and Z their own keys', () => {
    const { moves, rightCluster, shoulders } = padKeys('n64', 'mupen64plus_next')
    assert.deepEqual(moves, [
      { down: '↓', label: 'Stick', left: '←', right: '→', up: '↑' },
      { down: 'G', label: 'D-pad', left: 'F', right: 'H', up: 'T' },
    ])
    assert.deepEqual(rightCluster, { color: '#f2c21a', down: 'K', label: 'C', left: 'J', right: 'L', up: 'I' })
    assert.deepEqual(
      shoulders.left.map(({ key, label }) => `${label}=${key}`),
      ['L=Q', 'Z=E'],
    )
  })

  await it('shows the Genesis’s buttons on the keys they move to', () => {
    assert.deepEqual(
      padKeys('genesis', 'genesis_plus_gx').face.map((row) => row.map(({ key, label }) => `${label}=${key}`)),
      [
        ['X=A', 'Y=S', 'Z=D'],
        ['A=Z', 'B=X', 'C=C'],
      ],
    )
  })

  await it('calls Select Coin on a cabinet, and lists the ColecoVision’s keypad', () => {
    assert.deepEqual(
      padKeys('arcade', 'fbneo').center.map(({ label }) => label),
      ['Coin', 'Start'],
    )
    assert.deepEqual(
      padKeys('arcade', 'mame2003_plus').center.map(({ label }) => label),
      ['Coin', 'Start'],
    )
    assert.equal(padKeys('colecovision', 'gearcoleco').keypad, '1 – 0')
  })

  await it('leaves out what the player gave no key', () => {
    const { center, moves } = padKeys('gbc', 'mgba', { ...mapping, input_player1_select: '', input_player1_up: '' })
    assert.deepEqual(
      center.map(({ label }) => label),
      ['Start'],
    )
    assert.equal(moves[0].up, '')
  })

  await it('draws every console with every emulator', () => {
    for (const [platform, { cores }] of Object.entries(consoles)) {
      for (const core of cores) {
        const { face, moves } = padKeys(platform, core)
        assert.ok(moves.length > 0, `${platform} with ${core} has no way to move`)
        assert.ok(face.length > 0, `${platform} with ${core} has no buttons`)
      }
    }
  })
})
