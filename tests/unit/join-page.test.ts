import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { failureWordsFor, isGameGone, isNASCode, normalizeCode } from '#@/emulator/nas-games.ts'
import { standardButton } from '#@/input/guest-pad.ts'
import { holdsShortcut, remapController, serverGameTitle } from '#@/pages/library/join/controller.ts'

function pad(pressed: number[]) {
  return {
    axes: [0.5, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
  }
}

function heldIn(source: { buttons?: readonly { pressed: boolean }[] } | undefined) {
  return (source?.buttons ?? []).flatMap((button, index) => (button.pressed ? [index] : []))
}

await describe('the join page', async () => {
  await it('reads a letter O in a code as the zero a game on the server starts with', () => {
    assert.equal(normalizeCode(' ok7m 2p'), '0K7M2P')
    assert.ok(isNASCode('OK7M2P'))
    assert.ok(!isNASCode('K7M2PQ'))
  })

  await it('says what went wrong in the player’s words, by the server’s code', () => {
    assert.equal(failureWordsFor({ code: 'server_full', message: 'full' }), 'nasGames.full')
    assert.equal(failureWordsFor({ detail: { data: { code: 'server_one_game' } } }), 'join.gameLimit')
    assert.equal(failureWordsFor({ code: 'server_unreachable' }), 'join.serverUnavailable')
    assert.equal(failureWordsFor({ code: 'server_game_not_found' }), 'playTogether.notFound')
    assert.ok(isGameGone({ code: 'server_game_not_found' }))
    assert.equal(failureWordsFor(new TypeError('Failed to fetch')), 'join.serverUnreachable')
    assert.equal(failureWordsFor({ message: 'Someone else is joining that game' }), 'join.someoneJoining')
    assert.equal(failureWordsFor({ message: 'Someone has already joined that game' }), 'join.alreadyJoined')
    assert.equal(failureWordsFor({ message: 'something new' }), undefined)
    assert.equal(failureWordsFor({ code: 'something_new' }), undefined)
  })

  await it('plays a controller as it is where the player hasn’t set its buttons', () => {
    const controller = pad([0, 12])
    assert.equal(remapController(controller, undefined), controller)
  })

  await it('moves a controller’s buttons to where the player set them in Settings', () => {
    // A pad whose bottom face button reports as 2 and whose top one as 0
    const mapping = {
      input_player1_b_btn: '2',
      input_player1_l1_btn: '6',
      input_player1_l2_btn: '4',
      input_player1_y_btn: '0',
    }
    const remapped = remapController(pad([2, 6]), mapping)
    assert.deepEqual(
      heldIn(remapped),
      [standardButton.b, standardButton.l].toSorted((a, b) => a - b),
    )
    assert.deepEqual(remapped?.axes, [0.5, 0, 0, 0])
  })

  await it('knows the pause buttons are held by the controller’s settings', () => {
    const mapping = { input_player1_l1_btn: '4', input_player1_r1_btn: '5' }
    assert.ok(holdsShortcut(pad([4, 5]).buttons, 'L1 + R1', mapping))
    assert.ok(!holdsShortcut(pad([4]).buttons, 'L1 + R1', mapping))
  })

  await it('names a game on the server as the library does, keeping a period in its name', () => {
    assert.equal(serverGameTitle('Dr. Kawashima’s Brain Training', 'nds'), 'Dr. Kawashima’s Brain Training')
    assert.equal(serverGameTitle('Mr. Driller - Drill Spirits (USA).nds', 'nds'), 'Mr. Driller - Drill Spirits')
    assert.equal(serverGameTitle('Mr. Driller - Drill Spirits (USA).nds'), 'Mr. Driller - Drill Spirits')
  })
})
