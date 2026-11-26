// Measuring how a game runs on the device in hand, for the performance overlay. The emulator does its work inside the
// browser's animation frames, so timing those frames works for every emulator, with nothing built into any of them.
// The N64's and PSP's do part of their work outside the frame, so their time per frame can read low

/** One frame of the game: when the browser began it, and how long the page worked in it, both in milliseconds */
export interface FrameSample {
  at: number
  work: number
}

export interface FrameSummary {
  /** Frames counted */
  frames: number
  /** Frames shown per second, over the time the game was running */
  fps: number
  /** The middle frame's work, in milliseconds */
  typical: number
  /** The work 95 frames in 100 stayed within */
  p95: number
  /** The longest frame's work */
  worst: number
  /** Frames that arrived late: one or more of the screen's refreshes went by without them */
  slow: number
}

/** A full-speed frame's share of a second, in milliseconds, for a game that runs at `fps` */
export function frameBudget(fps = 60) {
  return 1000 / fps
}

// A frame this late is not a slow one: the game was paused, or the page hidden, and time stood still for it
const breakAfter = 1000
// Late enough to have missed a refresh, with room for the browser's own unevenness
const lateBy = 1.5

function percentile(sorted: number[], share: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
}

/** What `samples`, oldest first, say about how the game ran, against a full-speed frame of `budget` milliseconds */
export function summarizeFrames(samples: readonly FrameSample[], budget = frameBudget()): FrameSummary {
  let slow = 0
  let running = 0
  let gaps = 0
  for (let index = 1; index < samples.length; index += 1) {
    const gap = samples[index].at - samples[index - 1].at
    if (gap > 0 && gap <= breakAfter) {
      running += gap
      gaps += 1
      if (gap > budget * lateBy) {
        slow += 1
      }
    }
  }
  const work = samples.map((sample) => sample.work).toSorted((a, b) => a - b)
  return {
    fps: running > 0 ? (gaps * 1000) / running : 0,
    frames: samples.length,
    p95: percentile(work, 0.95),
    slow,
    typical: percentile(work, 0.5),
    worst: work.at(-1) ?? 0,
  }
}

export interface FrameBar {
  /** From 0 to 1, where a full-speed frame's whole time is half way up */
  height: number
  /** Arrived late */
  late: boolean
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
    for (let index = start; index < Math.min(samples.length, start + perBar); index += 1) {
      const gap = index > 0 ? samples[index].at - samples[index - 1].at : 0
      const isLate = gap > budget * lateBy && gap <= breakAfter
      late ||= isLate
      value = Math.max(value, isLate ? gap : samples[index].work)
    }
    bars.push({ height: Math.min(1, value / (budget * 2)), late })
  }
  return bars
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
   * Told each finished frame, and whether it was marked with `mark()` while it ran. A screen that refreshes faster than
   * the game runs gives the emulator frames it lets pass; whoever knows a picture was drawn marks the ones that count
   */
  onFrame: (sample: FrameSample, marked: boolean) => void
}

/**
 * Times every animation frame of `host` (the page) from now until `stop()`: all the work its callbacks do in one frame,
 * as one sample. A frame is reported when the next one begins, so the last one before `stop()` is not.
 */
export function timeAnimationFrames(host: FrameHost, { now, onFrame }: FrameTimerOptions) {
  const clock = now ?? (() => performance.now())
  const original = host.requestAnimationFrame
  let current: (FrameSample & { marked: boolean }) | undefined
  let stopped = false

  function report() {
    if (current) {
      onFrame({ at: current.at, work: current.work }, current.marked)
    }
  }

  function timed(callback: FrameCallback): FrameCallback {
    return (time) => {
      if (stopped) {
        callback(time)
        return
      }
      if (current?.at !== time) {
        report()
        current = { at: time, marked: false, work: 0 }
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
    /** The frame running now counts: a picture was drawn in it */
    mark() {
      if (current) {
        current.marked = true
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
