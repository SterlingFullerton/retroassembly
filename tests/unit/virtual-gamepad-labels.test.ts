import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getVirtualGamepadLabels } from '#@/pages/library/components/emulator-portal/game-overlay/virtual-gamepad-labels.ts'

await describe('on-screen gamepad labels', async () => {
  await it("uses the console's own names where the emulator's mapping is known", () => {
    const genesis = getVirtualGamepadLabels('genesis', 'genesis_plus_gx')
    assert.deepEqual([genesis.y, genesis.b, genesis.a], ['A', 'B', 'C'])
    assert.equal(getVirtualGamepadLabels('psx', 'pcsx_rearmed').b, '✕')
    assert.equal(getVirtualGamepadLabels('colecovision', 'gearcoleco').start, '✱')
  })

  await it('hides buttons the emulator does nothing with', () => {
    const gameBoy = getVirtualGamepadLabels('gb', 'mgba')
    assert.equal(gameBoy.x, null)
    assert.equal(gameBoy.l, null)
    assert.equal(gameBoy.a, 'A')
    assert.equal(getVirtualGamepadLabels('snes', 'snes9x').l2, null)
  })

  await it('keeps the generic labels for other emulators and systems', () => {
    const generic = getVirtualGamepadLabels('genesis', 'picodrive')
    assert.deepEqual([generic.y, generic.l, generic.select], ['Y', 'L1', 'Select'])
    assert.equal(getVirtualGamepadLabels('atari2600', 'stella2014').x, 'X')
  })
})
