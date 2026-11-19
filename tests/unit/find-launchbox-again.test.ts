import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getNameForLaunchbox } from '#@/utils/server/find-launchbox-again.ts'

await describe('getNameForLaunchbox', async () => {
  await it('drops revision and dump tags, keeping the region', () => {
    assert.equal(getNameForLaunchbox('Castlevania Rev PRG1 (USA)'), 'Castlevania (USA)')
    assert.equal(getNameForLaunchbox('Castlevania (U) (PRG1) [!]'), 'Castlevania (U)')
    assert.equal(getNameForLaunchbox('Hunt for Red October Rev 1, The (USA)'), 'Hunt for Red October, The (USA)')
    assert.equal(
      getNameForLaunchbox('Quack Shot Starring Donald Duck (W) (REV01) [!]'),
      'Quack Shot Starring Donald Duck (W)',
    )
    assert.equal(getNameForLaunchbox('Draque Buster (Japan)[h][Dragon Buster]'), 'Draque Buster (Japan)')
  })

  await it('leaves a plain name alone', () => {
    assert.equal(getNameForLaunchbox("Kirby's Adventure (USA)"), "Kirby's Adventure (USA)")
  })
})
