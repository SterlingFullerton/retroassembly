import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createFrameLog,
  frameBars,
  type FrameSample,
  frameBudget,
  summarizeFrames,
  timeAnimationFrames,
} from '#@/emulator/perf.ts'

function steady(count: number, gap: number, work: number): FrameSample[] {
  return Array.from({ length: count }, (_, index) => ({ at: index * gap, work }))
}

function noop() {
  // A callback with nothing to do
}

// A page whose frames the test runs by hand, with a clock it moves itself
function fakePage() {
  let queue: ((time: number) => void)[] = []
  let time = 0
  const page = {
    advance(milliseconds: number) {
      time += milliseconds
    },
    now: () => time,
    requestAnimationFrame(callback: (time: number) => void) {
      queue.push(callback)
      return queue.length
    },
    /** Runs one frame: every callback asked for since the last, all given the same time */
    runFrame(at: number) {
      const callbacks = queue
      queue = []
      time = at
      for (const callback of callbacks) {
        callback(at)
      }
    },
  }
  return page
}

await describe('a summary of frames', async () => {
  await it('is all zeros with nothing to go on', () => {
    assert.deepEqual(summarizeFrames([]), { fps: 0, frames: 0, p95: 0, slow: 0, typical: 0, worst: 0 })
    assert.equal(summarizeFrames([{ at: 5, work: 3 }]).fps, 0)
  })

  await it('reads a steady 60 fps game as full speed, with no slow frames', () => {
    const summary = summarizeFrames(steady(600, frameBudget(), 6))
    assert.equal(Math.round(summary.fps), 60)
    assert.equal(summary.frames, 600)
    assert.equal(summary.slow, 0)
    assert.equal(summary.typical, 6)
    assert.equal(summary.worst, 6)
  })

  await it('counts a frame that missed a refresh as slow, and shows it in the worst and the frame rate', () => {
    const budget = frameBudget()
    const samples = steady(60, budget, 5)
    // One frame took two refreshes: everything after it is a refresh later
    for (let index = 30; index < samples.length; index += 1) {
      samples[index].at += budget
    }
    samples[29].work = 30
    const summary = summarizeFrames(samples)
    assert.equal(summary.slow, 1)
    assert.equal(summary.worst, 30)
    assert.equal(summary.typical, 5)
    assert.ok(summary.fps < 60 && summary.fps > 58)
  })

  await it('reads a game running at half speed as 30 fps, every frame slow', () => {
    const summary = summarizeFrames(steady(100, frameBudget(30), 28))
    assert.equal(Math.round(summary.fps), 30)
    assert.equal(summary.slow, 99)
  })

  await it('measures a 50 fps game against its own frame', () => {
    const samples = steady(100, frameBudget(50), 8)
    assert.equal(summarizeFrames(samples, frameBudget(50)).slow, 0)
    assert.equal(Math.round(summarizeFrames(samples, frameBudget(50)).fps), 50)
  })

  await it('leaves a pause out: not a slow frame, and not time the game was running', () => {
    const budget = frameBudget()
    const samples = [
      ...steady(60, budget, 5),
      ...steady(60, budget, 5).map(({ at, work }) => ({ at: at + 60 * budget + 30_000, work })),
    ]
    const summary = summarizeFrames(samples)
    assert.equal(summary.slow, 0)
    assert.equal(Math.round(summary.fps), 60)
  })

  await it('gives the work 95 frames in 100 stayed within', () => {
    const samples = steady(100, frameBudget(), 4)
    for (const index of [10, 20, 30, 40, 50, 60]) {
      samples[index].work = 20
    }
    const summary = summarizeFrames(samples)
    assert.equal(summary.typical, 4)
    assert.equal(summary.p95, 20)
    samples[20].work = 4
    samples[30].work = 4
    assert.equal(summarizeFrames(samples).p95, 4)
  })
})

await describe('the graph’s bars', async () => {
  await it('put a full-speed frame’s whole time half way up, and mark late frames by how long they took', () => {
    const budget = frameBudget()
    const samples = steady(4, budget, budget / 2)
    samples[3].at += budget
    const bars = frameBars(samples, 4)
    assert.deepEqual(
      bars.map((bar) => bar.late),
      [false, false, false, true],
    )
    assert.equal(bars[0].height, 0.25)
    assert.equal(bars[3].height, 1)
  })

  await it('stand for runs of frames by their worst one when there are more frames than bars', () => {
    const samples = steady(120, frameBudget(), 4)
    samples[61].work = 12
    const bars = frameBars(samples, 40)
    assert.equal(bars.length, 40)
    const tallest = Math.max(...bars.map((bar) => bar.height))
    assert.equal(
      bars.findIndex((bar) => bar.height === tallest),
      20,
    )
    assert.ok(bars.every((bar) => !bar.late))
  })

  await it('are none with no frames, and don’t count a pause as a late frame', () => {
    assert.deepEqual(frameBars([], 40), [])
    const samples = steady(2, 30_000, 4)
    assert.ok(frameBars(samples, 2).every((bar) => !bar.late))
  })
})

await describe('the log of frames', async () => {
  await it('keeps the latest ones, up to its capacity', () => {
    const log = createFrameLog(3)
    for (const sample of steady(5, 10, 1)) {
      log.add(sample)
    }
    assert.equal(log.size, 3)
    assert.deepEqual(
      log.latest(1000).map((sample) => sample.at),
      [20, 30, 40],
    )
  })

  await it('gives the frames of the last while, counted back from the latest', () => {
    const log = createFrameLog()
    for (const sample of steady(100, 10, 1)) {
      log.add(sample)
    }
    const latest = log.latest(100)
    assert.equal(latest.length, 11)
    assert.equal(latest[0].at, 890)
    assert.equal(latest.at(-1)?.at, 990)
  })

  await it('is empty once cleared', () => {
    const log = createFrameLog()
    log.add({ at: 1, work: 1 })
    log.clear()
    assert.equal(log.size, 0)
    assert.deepEqual(log.latest(1000), [])
  })
})

await describe('timing the page’s frames', async () => {
  await it('reports each frame once the next begins, with all its callbacks’ work added up', () => {
    const page = fakePage()
    const frames: FrameSample[] = []
    timeAnimationFrames(page, { now: page.now, onFrame: (sample) => frames.push(sample) })

    // Two callbacks in the first frame: the emulator's 7 ms and the page's own 2 ms
    page.requestAnimationFrame(() => page.advance(7))
    page.requestAnimationFrame(() => page.advance(2))
    page.runFrame(100)
    assert.deepEqual(frames, [])

    page.requestAnimationFrame(() => page.advance(4))
    page.runFrame(116)
    assert.deepEqual(frames, [{ at: 100, work: 9 }])

    page.requestAnimationFrame(noop)
    page.runFrame(133)
    assert.deepEqual(frames.at(-1), { at: 116, work: 4 })
  })

  await it('passes each callback its time, and times it even when it throws', () => {
    const page = fakePage()
    const frames: FrameSample[] = []
    const times: number[] = []
    timeAnimationFrames(page, { now: page.now, onFrame: (sample) => frames.push(sample) })

    page.requestAnimationFrame((time) => {
      times.push(time)
      page.advance(3)
      throw new Error('the game stopped')
    })
    assert.throws(() => page.runFrame(50), /the game stopped/u)
    page.requestAnimationFrame(noop)
    page.runFrame(66)
    assert.deepEqual(times, [50])
    assert.deepEqual(frames, [{ at: 50, work: 3 }])
  })

  await it('says which frames were marked, as on a screen faster than the game', () => {
    const page = fakePage()
    const frames: [number, boolean][] = []
    const timer = timeAnimationFrames(page, {
      now: page.now,
      onFrame: (sample, marked) => frames.push([sample.at, marked]),
    })

    // A 120 Hz screen: the emulator draws in every other frame and lets the rest pass
    for (let index = 0; index < 5; index += 1) {
      const draws = index % 2 === 0
      page.requestAnimationFrame(() => {
        if (draws) {
          timer.mark()
        }
      })
      page.runFrame(index * 8)
    }
    assert.deepEqual(frames, [
      [0, true],
      [8, false],
      [16, true],
      [24, false],
    ])
  })

  await it('puts the page back as it was when stopped, and lets waiting callbacks through untimed', () => {
    const page = fakePage()
    const original = page.requestAnimationFrame
    const frames: FrameSample[] = []
    const timer = timeAnimationFrames(page, { now: page.now, onFrame: (sample) => frames.push(sample) })
    assert.notEqual(page.requestAnimationFrame, original)

    let ran = false
    page.requestAnimationFrame(() => {
      ran = true
    })
    timer.stop()
    assert.equal(page.requestAnimationFrame, original)
    page.runFrame(10)
    assert.ok(ran)
    assert.deepEqual(frames, [])
  })

  await it('leaves a later wrapper in place when stopped', () => {
    const page = fakePage()
    const timer = timeAnimationFrames(page, { now: page.now, onFrame: noop })
    const ours = page.requestAnimationFrame
    function later(callback: (time: number) => void) {
      return ours(callback)
    }
    page.requestAnimationFrame = later
    timer.stop()
    assert.equal(page.requestAnimationFrame, later)
  })
})
