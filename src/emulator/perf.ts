// Measuring how a game runs on the device in hand, for the performance overlay. The emulator does its work inside the
// browser's animation frames, so timing those frames works for every emulator, with nothing built into any of them.
// The N64's and PSP's do part of their work outside the frame, so their time per frame can read low

/**
 * One frame of the game: when the browser began it and how long the page worked in it, both in milliseconds, and how
 * many times the game's picture was drawn to
 */
export interface FrameSample {
  at: number
  draws: number
  work: number
}

/** How a run of numbers is spread: its ends, its average, and the values 50, 95 and 99 in 100 stay within */
export interface Spread {
  avg: number
  max: number
  min: number
  p50: number
  p95: number
  p99: number
}

export interface FrameSummary {
  /** Draw calls per frame, on average */
  draws: number
  /** Frames that arrived late: one or more of the screen's refreshes went by without them */
  dropped: number
  /** Frames shown per second, over the time the game was running */
  fps: number
  /** Frames counted */
  frames: number
  /** The time from one frame to the next, in milliseconds */
  interval: Spread
  /** The emulator's work as a share of a full-speed frame's time, 1 being all of it: on average, and at its most */
  loadAverage: number
  loadPeak: number
  /** The frame rate of the slowest 1 frame in 100, and in 1000 */
  low1: number
  low01: number
  /** Frames whose work alone took longer than a full-speed frame has */
  overBudget: number
  /** The frame rate the game is taken to aim for */
  target: number
  /** The page's work in a frame, in milliseconds */
  work: Spread
}

/** A full-speed frame's share of a second, in milliseconds, for a game that runs at `fps` */
export function frameBudget(fps = 60) {
  return 1000 / fps
}

// A frame this late is not a slow one: the game was paused, or the page hidden, and time stood still for it
const breakAfter = 1000
// Late enough to have missed a refresh, with room for the browser's own unevenness
const lateBy = 1.5
// Late enough to be felt as a hitch
const stalledBy = 3

function percentile(sorted: number[], share: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
}

function spreadOf(values: number[]): { sorted: number[]; spread: Spread } {
  const sorted = values.toSorted((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    sorted,
    spread: {
      avg: sorted.length > 0 ? total / sorted.length : 0,
      max: sorted.at(-1) ?? 0,
      min: sorted[0] ?? 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    },
  }
}

function getIntervals(samples: readonly FrameSample[]) {
  const intervals: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const gap = samples[index].at - samples[index - 1].at
    if (gap > 0 && gap <= breakAfter) {
      intervals.push(gap)
    }
  }
  return intervals
}

/**
 * The frame rate a game is taken to aim for, from the time its frames usually take: 50 for one running steadily at 50,
 * as European games do, and 60 otherwise. The emulator doesn't say, so this is a reading, not a fact
 */
export function guessTargetFps(usualInterval: number) {
  return Math.abs(usualInterval - frameBudget(50)) < frameBudget(50) * 0.04 ? 50 : 60
}

/** What `samples`, oldest first, say about how the game ran. `target` is its full-speed frame rate, when it's known */
export function summarizeFrames(samples: readonly FrameSample[], target?: number): FrameSummary {
  const intervals = spreadOf(getIntervals(samples))
  const work = spreadOf(samples.map((sample) => sample.work))
  const aim = target ?? guessTargetFps(intervals.spread.p50)
  const budget = frameBudget(aim)
  const running = intervals.sorted.reduce((sum, gap) => sum + gap, 0)
  const slowest = percentile(intervals.sorted, 0.999)
  const drawn = samples.reduce((sum, sample) => sum + sample.draws, 0)
  return {
    draws: samples.length > 0 ? drawn / samples.length : 0,
    dropped: intervals.sorted.filter((gap) => gap > budget * lateBy).length,
    fps: running > 0 ? (intervals.sorted.length * 1000) / running : 0,
    frames: samples.length,
    interval: intervals.spread,
    loadAverage: work.spread.avg / budget,
    loadPeak: work.spread.max / budget,
    low01: slowest > 0 ? 1000 / slowest : 0,
    low1: intervals.spread.p99 > 0 ? 1000 / intervals.spread.p99 : 0,
    overBudget: work.sorted.filter((value) => value > budget).length,
    target: aim,
    work: work.spread,
  }
}

export interface FrameBar {
  /** From 0 to 1, where a full-speed frame's whole time is half way up */
  height: number
  /** Arrived late */
  late: boolean
  /** Arrived late enough to be felt as a hitch */
  stalled: boolean
}

/**
 * `samples` as `count` bars for a graph, oldest first, each standing for a run of frames by its worst one: the frame's
 * work, or for a late frame how long it took to arrive
 */
export function frameBars(samples: readonly FrameSample[], count: number, budget = frameBudget()): FrameBar[] {
  const perBar = Math.max(1, Math.ceil(samples.length / count))
  const bars: FrameBar[] = []
  for (let start = 0; start < samples.length; start += perBar) {
    let value = 0
    let late = false
    let stalled = false
    for (let index = start; index < Math.min(samples.length, start + perBar); index += 1) {
      const gap = index > 0 ? samples[index].at - samples[index - 1].at : 0
      const counts = gap <= breakAfter
      const isLate = counts && gap > budget * lateBy
      late ||= isLate
      stalled ||= counts && gap > budget * stalledBy
      value = Math.max(value, isLate ? gap : samples[index].work)
    }
    bars.push({ height: Math.min(1, value / (budget * 2)), late, stalled })
  }
  return bars
}

// The rates screens come in. A measured rate within a twentieth of one is taken to be it
const refreshRates = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]

/** The screen's refresh rate, in Hz, from the times of its latest frames; 0 with too few to tell */
export function estimateRefreshRate(times: readonly number[]) {
  const gaps: number[] = []
  for (let index = 1; index < times.length; index += 1) {
    gaps.push(times[index] - times[index - 1])
  }
  const usual = percentile(
    gaps.toSorted((a, b) => a - b),
    0.5,
  )
  if (gaps.length < 10 || usual <= 0) {
    return 0
  }
  const measured = 1000 / usual
  return refreshRates.find((rate) => Math.abs(rate - measured) < rate * 0.05) ?? Math.round(measured)
}

/** The latest frames, up to `capacity` of them: 20 seconds of a 60 fps game unless told otherwise */
export function createFrameLog(capacity = 1200) {
  const samples: FrameSample[] = []
  return {
    add(sample: FrameSample) {
      samples.push(sample)
      if (samples.length > capacity) {
        samples.splice(0, samples.length - capacity)
      }
    },
    clear() {
      samples.length = 0
    },
    /** The frames of the last `milliseconds`, counted back from the latest one, oldest first */
    latest(milliseconds: number) {
      const from = (samples.at(-1)?.at ?? 0) - milliseconds
      return samples.filter((sample) => sample.at >= from)
    },
    get size() {
      return samples.length
    },
  }
}

export type FrameLog = ReturnType<typeof createFrameLog>

type FrameCallback = (time: number) => void

interface FrameHost {
  requestAnimationFrame: (callback: FrameCallback) => number
}

interface FrameTimerOptions {
  /** The clock work is timed with; the page's own unless given */
  now?: () => number
  /**
   * Told each finished frame: when it began, the work done in it, and how many times it was marked with `mark()` while
   * it ran. A screen that refreshes faster than the game runs gives the emulator frames it lets pass; whoever knows a
   * picture was drawn marks the ones that count
   */
  onFrame: (frame: { at: number; marks: number; work: number }) => void
}

/**
 * Times every animation frame of `host` (the page) from now until `stop()`: all the work its callbacks do in one frame,
 * as one sample. A frame is reported when the next one begins, so the last one before `stop()` is not.
 */
export function timeAnimationFrames(host: FrameHost, { now, onFrame }: FrameTimerOptions) {
  const clock = now ?? (() => performance.now())
  const original = host.requestAnimationFrame
  let current: { at: number; marks: number; work: number } | undefined
  let stopped = false

  function timed(callback: FrameCallback): FrameCallback {
    return (time) => {
      if (stopped) {
        callback(time)
        return
      }
      if (current?.at !== time) {
        if (current) {
          onFrame(current)
        }
        current = { at: time, marks: 0, work: 0 }
      }
      const frame = current
      const started = clock()
      try {
        callback(time)
      } finally {
        frame.work += clock() - started
      }
    }
  }

  function requestTimedFrame(this: unknown, callback: FrameCallback) {
    return Reflect.apply(original, host, [timed(callback)])
  }
  host.requestAnimationFrame = requestTimedFrame

  return {
    /** Something was drawn in the frame running now */
    mark() {
      if (current) {
        current.marks += 1
      }
    },
    stop() {
      stopped = true
      current = undefined
      // Left in place if something else has wrapped it since; its callbacks then pass straight through
      if (host.requestAnimationFrame === requestTimedFrame) {
        host.requestAnimationFrame = original
      }
    },
  }
}
