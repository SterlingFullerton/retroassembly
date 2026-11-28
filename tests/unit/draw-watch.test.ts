import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { noop } from 'es-toolkit'

// A 3D canvas's drawing functions, as the browser's prototype has them
class FakeContext {
  canvas: unknown
  drawn = 0
  constructor(canvas: unknown) {
    this.canvas = canvas
  }
  drawArrays() {
    this.drawn += 1
  }
}
Object.assign(globalThis, { WebGLRenderingContext: FakeContext })
const { watchDraws } = await import('#@/emulator/draw-watch.ts')
const original = FakeContext.prototype.drawArrays

await describe('watching what a canvas draws', async () => {
  await it('tells each watcher of its own canvas’s draws only', () => {
    const [first, second] = [{}, {}] as unknown as HTMLCanvasElement[]
    const seen: string[] = []
    const stopFirst = watchDraws(first, () => seen.push('first'))
    const stopSecond = watchDraws(second, () => seen.push('second'))
    const context = new FakeContext(first)
    context.drawArrays()
    new FakeContext(second).drawArrays()
    assert.deepEqual(seen, ['first', 'second'])
    assert.equal(context.drawn, 1)
    stopFirst()
    stopSecond()
  })

  await it('puts the drawing functions back however the watchers stop', () => {
    const canvas = {} as unknown as HTMLCanvasElement
    const stops = [watchDraws(canvas, noop), watchDraws(canvas, noop), watchDraws(canvas, noop)]
    assert.notEqual(FakeContext.prototype.drawArrays, original)
    // The first to start stops first, then the last, then the middle one
    stops[0]()
    stops[2]()
    assert.notEqual(FakeContext.prototype.drawArrays, original)
    stops[1]()
    assert.equal(FakeContext.prototype.drawArrays, original)
  })
})
