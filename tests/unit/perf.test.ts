import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createFrameLog,
  estimateRefreshRate,
  frameBars,
  type FrameSample,
  frameBudget,
  guessTargetFps,
  summarizeFrames,
  timeAnimationFrames,
} from '#@/emulator/perf.ts'

function steady(count: number, gap: number, work: number): FrameSample[] {
  return Array.from({ length: count }, (_, index) => ({ at: index * gap, draws: 1, work }))
}

function ticks(count: number, gap: number) {
  return Array.from({ length: count }, (_, index) => index * gap)
}

function noop() {
  // A callback with nothing to do
}

function near(actual: number, expected: number, within = 0.01) {
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`)
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
    const summary = summarizeFrames([])
    assert.equal(summary.frames, 0)
    assert.equal(summary.fps, 0)
    assert.equal(summary.low1, 0)
    assert.deepEqual(summary.work, { avg: 0, max: 0, min: 0, p50: 0, p95: 0, p99: 0 })
    assert.equal(summarizeFrames([{ at: 5, draws: 1, work: 3 }]).fps, 0)
  })

  await it('reads a steady 60 fps game as full speed, with nothing dropped', () => {
    const summary = summarizeFrames(steady(600, frameBudget(), 6))
    near(summary.fps, 60)
    assert.equal(summary.target, 60)
    assert.equal(summary.frames, 600)
    assert.equal(summary.dropped, 0)
    assert.equal(summary.overBudget, 0)
    assert.equal(summary.work.avg, 6)
    assert.equal(summary.work.max, 6)
    near(summary.interval.p50, frameBudget())
    near(summary.low1, 60)
    near(summary.loadAverage, 0.36)
    assert.equal(summary.draws, 1)
  })

  await it('counts a frame that missed a refresh as dropped, and shows it in the ends', () => {
    const budget = frameBudget()
    const samples = steady(60, budget, 5)
    // One frame took two refreshes: everything after it is a refresh later
    for (let index = 30; index < samples.length; index += 1) {
      samples[index].at += budget
    }
    samples[29].work = 30
    const summary = summarizeFrames(samples)
    assert.equal(summary.dropped, 1)
    assert.equal(summary.overBudget, 1)
    assert.equal(summary.work.max, 30)
    assert.equal(summary.work.p50, 5)
    near(summary.interval.max, budget * 2)
    near(summary.loadPeak, 1.8)
    near(summary.low1, 30)
    assert.ok(summary.fps < 60 && summary.fps > 58)
  })

  await it('reads a game running at half speed as 30 fps, every frame dropped', () => {
    const summary = summarizeFrames(steady(100, frameBudget(30), 28))
    near(summary.fps, 30)
    assert.equal(summary.dropped, 99)
    assert.equal(summary.overBudget, 100)
  })

  await it('takes a game running steadily at 50 fps to aim for 50, and measures it against that', () => {
    const summary = summarizeFrames(steady(100, frameBudget(50), 8))
    assert.equal(summary.target, 50)
    assert.equal(summary.dropped, 0)
    near(summary.fps, 50)
    near(summary.loadAverage, 0.4)
    assert.equal(guessTargetFps(frameBudget(60)), 60)
    assert.equal(guessTargetFps(frameBudget(30)), 60)
    assert.equal(guessTargetFps(0), 60)
  })

  await it('goes by the frame rate it’s told, when told one', () => {
    const summary = summarizeFrames(steady(100, frameBudget(60), 8), 50)
    assert.equal(summary.target, 50)
    near(summary.loadAverage, 0.4)
  })

  await it('leaves a pause out: not a dropped frame, and not time the game was running', () => {
    const budget = frameBudget()
    const samples = [
      ...steady(60, budget, 5),
      ...steady(60, budget, 5).map(({ at, draws, work }) => ({ at: at + 60 * budget + 30_000, draws, work })),
    ]
    const summary = summarizeFrames(samples)
    assert.equal(summary.dropped, 0)
    near(summary.fps, 60)
    near(summary.interval.max, budget)
  })

  await it('gives the work 95 and 99 frames in 100 stayed within', () => {
    const samples = steady(100, frameBudget(), 4)
    for (const index of [10, 20, 30, 40, 50, 60]) {
      samples[index].work = 20
    }
    const summary = summarizeFrames(samples)
    assert.equal(summary.work.p50, 4)
    assert.equal(summary.work.p95, 20)
    assert.equal(summary.work.min, 4)
    near(summary.work.avg, 4.96)
    samples[20].work = 4
    samples[30].work = 4
    assert.equal(summarizeFrames(samples).work.p95, 4)
    assert.equal(summarizeFrames(samples).work.p99, 20)
  })

  await it('averages the draw calls of its frames', () => {
    const samples = steady(4, frameBudget(), 4)
    samples[0].draws = 3
    samples[1].draws = 3
    samples[2].draws = 5
    samples[3].draws = 5
    assert.equal(summarizeFrames(samples).draws, 4)
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
    assert.ok(bars.every((bar) => !bar.stalled))
  })

  await it('mark a frame that took several refreshes as a stall', () => {
    const budget = frameBudget()
    const samples = steady(4, budget, 5)
    samples[3].at += budget * 3
    const bars = frameBars(samples, 4)
    assert.deepEqual(
      bars.map((bar) => bar.stalled),
      [false, false, false, true],
    )
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
    assert.ok(frameBars(samples, 2).every((bar) => !bar.late && !bar.stalled))
  })
})

await describe('the screen’s refresh rate', async () => {
  await it('is the rate screens come in that the frames’ times are nearest', () => {
    assert.equal(estimateRefreshRate(ticks(60, 1000 / 60)), 60)
    assert.equal(estimateRefreshRate(ticks(60, 8.4)), 120)
    assert.equal(estimateRefreshRate(ticks(60, 6.9)), 144)
    assert.equal(estimateRefreshRate(ticks(60, 16.4)), 60)
  })

  await it('is what was measured when no usual rate is near', () => {
    assert.equal(estimateRefreshRate(ticks(60, 1000 / 37)), 37)
  })

  await it('goes by the usual gap, whatever a few late frames did', () => {
    const times = ticks(60, 1000 / 120)
    for (let index = 30; index < times.length; index += 1) {
      times[index] += 200
    }
    assert.equal(estimateRefreshRate(times), 120)
  })

  await it('is 0 with too few frames to tell', () => {
    assert.equal(estimateRefreshRate([]), 0)
    assert.equal(estimateRefreshRate(ticks(5, 16)), 0)
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
    log.add({ at: 1, draws: 1, work: 1 })
    log.clear()
    assert.equal(log.size, 0)
    assert.deepEqual(log.latest(1000), [])
  })
})

await describe('timing the page’s frames', async () => {
  await it('reports each frame once the next begins, with all its callbacks’ work added up', () => {
    const page = fakePage()
    const frames: { at: number; work: number }[] = []
    timeAnimationFrames(page, { now: page.now, onFrame: ({ at, work }) => frames.push({ at, work }) })

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
    const frames: { at: number; work: number }[] = []
    const times: number[] = []
    timeAnimationFrames(page, { now: page.now, onFrame: ({ at, work }) => frames.push({ at, work }) })

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

  await it('counts each frame’s marks, as on a screen faster than the game', () => {
    const page = fakePage()
    const frames: [number, number][] = []
    const timer = timeAnimationFrames(page, {
      now: page.now,
      onFrame: ({ at, marks }) => frames.push([at, marks]),
    })

    // A 120 Hz screen: the emulator draws, three calls a picture, in every other frame and lets the rest pass
    for (let index = 0; index < 5; index += 1) {
      const draws = index % 2 === 0
      page.requestAnimationFrame(() => {
        if (draws) {
          timer.mark()
          timer.mark()
          timer.mark()
        }
      })
      page.runFrame(index * 8)
    }
    assert.deepEqual(frames, [
      [0, 3],
      [8, 0],
      [16, 3],
      [24, 0],
    ])
  })

  await it('puts the page back as it was when stopped, and lets waiting callbacks through untimed', () => {
    const page = fakePage()
    const original = page.requestAnimationFrame
    const frames: number[] = []
    const timer = timeAnimationFrames(page, { now: page.now, onFrame: ({ at }) => frames.push(at) })
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
