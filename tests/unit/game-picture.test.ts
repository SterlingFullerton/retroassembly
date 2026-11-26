import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getPictureLayout, isSameArea, toPictureArea } from '#@/emulator/game-picture.ts'

function near(actual: number | undefined, expected: number) {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 0.0001, `${actual} is not ${expected}`)
}

await describe('where a game’s picture is on its canvas', async () => {
  await it('is the whole canvas when the picture fills it', () => {
    assert.deepEqual(toPictureArea([0, 0, 1024, 768], 1024, 768), {
      aspect: 4 / 3,
      height: 1,
      left: 0,
      top: 0,
      width: 1,
    })
  })

  await it('is the middle of a wide screen, with black either side', () => {
    // A 4:3 picture on a 1920 by 1080 screen
    const area = toPictureArea([240, 0, 1440, 1080], 1920, 1080)
    near(area?.left, 0.125)
    near(area?.width, 0.75)
    near(area?.top, 0)
    near(area?.height, 1)
    near(area?.aspect, 4 / 3)
  })

  await it('is measured from the top, though the drawing rectangle is measured from the bottom', () => {
    // On an upright phone the picture sits at the top, above the controls: 1170 wide, 878 tall, 2532 - 878 from the bottom
    const area = toPictureArea([0, 1654, 1170, 878], 1170, 2532)
    near(area?.top, 0)
    near(area?.height, 878 / 2532)
    near(area?.width, 1)
    near(area?.aspect, 1170 / 878)
    near(toPictureArea([0, 0, 1170, 878], 1170, 2532)?.top, 1654 / 2532)
  })

  await it('is cut to the canvas when the rectangle runs past it', () => {
    const area = toPictureArea([-100, -50, 1200, 900], 1000, 800)
    assert.deepEqual(area, { aspect: 1000 / 800, height: 1, left: 0, top: 0, width: 1 })
  })

  await it('is nothing for a rectangle or a canvas with no area, or a rectangle off the canvas', () => {
    assert.equal(toPictureArea([0, 0, 0, 100], 100, 100), undefined)
    assert.equal(toPictureArea([0, 0, 100, 100], 0, 100), undefined)
    assert.equal(toPictureArea([200, 0, 100, 100], 100, 100), undefined)
  })

  await it('counts as the same when it moved less than anyone would see', () => {
    const area = toPictureArea([240, 0, 1440, 1080], 1920, 1080)
    assert.ok(isSameArea(area, toPictureArea([240, 0, 1441, 1080], 1920, 1080)))
    assert.ok(!isSameArea(area, toPictureArea([0, 0, 1920, 1080], 1920, 1080)))
    assert.ok(!isSameArea(area, undefined))
    assert.ok(isSameArea(undefined, undefined))
  })
})

await describe('showing only the picture from a video of the whole canvas', async () => {
  await it('is nothing until the picture’s place is known', () => {
    assert.equal(getPictureLayout(undefined), undefined)
  })

  await it('leaves the video as it is when the picture fills the canvas', () => {
    const layout = getPictureLayout(toPictureArea([0, 0, 1024, 768], 1024, 768))
    assert.deepEqual(layout?.video, { height: '100%', left: '0%', top: '0%', width: '100%' })
    assert.equal(layout?.box.aspectRatio, String(4 / 3))
  })

  await it('enlarges and moves the video so the picture fills a box of its own shape', () => {
    // The 4:3 picture in the middle three quarters of a wide screen
    const layout = getPictureLayout(toPictureArea([240, 0, 1440, 1080], 1920, 1080))
    assert.equal(layout?.video.width, `${100 / 0.75}%`)
    assert.equal(layout?.video.left, `${(-0.125 / 0.75) * 100}%`)
    assert.equal(layout?.video.height, '100%')
    assert.equal(layout?.video.top, '0%')
    assert.equal(layout?.box.width, `min(100vw, calc(100dvh * ${4 / 3}))`)
  })
})
