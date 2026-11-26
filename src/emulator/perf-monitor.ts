import { getAudioInfo } from './audio.ts'
import { watchDraws } from './draw-watch.ts'
import { createFrameLog, estimateRefreshRate, timeAnimationFrames } from './perf.ts'

// The performance overlay's switch, and the watch it keeps on a running game. The switch is kept in this browser, so
// turning it on for one device shows it on no other

const storageKey = 'retroassembly-perf-overlay'

function load() {
  try {
    return globalThis.localStorage?.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

let enabled = load()
const listeners = new Set<() => void>()

export function isPerfOverlayEnabled() {
  return enabled
}

export function setPerfOverlayEnabled(value: boolean) {
  enabled = value
  try {
    if (value) {
      globalThis.localStorage?.setItem(storageKey, '1')
    } else {
      globalThis.localStorage?.removeItem(storageKey)
    }
  } catch {}
  for (const listener of listeners) {
    listener()
  }
}

/** Calls `listener` whenever the switch changes, until the function it returns is called */
export function subscribePerfOverlay(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Two seconds of a 120 Hz screen
const screenFramesKept = 240

// One game runs at a time, so one watch
let current: FrameWatch | undefined

/**
 * Keeps a log of the frames of the game on `canvas` from now until `stop()`. A frame counts when a picture was drawn in
 * it, so a screen faster than the game doesn't count double. An emulator whose drawing can't be seen from the page
 * (one that draws from another thread) has every frame of the screen counted instead, and `exact` stays false: its
 * frame rate is then the screen's, not the game's
 */
export function watchFrames(canvas: HTMLCanvasElement) {
  const log = createFrameLog()
  // When each of the screen's latest frames began, drawn in or not: what its refresh rate is read from
  const screenFrames: number[] = []
  let exact = false
  let paused = false
  const timer = timeAnimationFrames(globalThis, {
    onFrame({ at, marks, work }) {
      screenFrames.push(at)
      if (screenFrames.length > screenFramesKept) {
        screenFrames.shift()
      }
      if (paused) {
        return
      }
      if (marks > 0 && !exact) {
        // The first picture seen drawn: what was counted before it was the screen's frames
        exact = true
        log.clear()
      }
      if (marks > 0 || !exact) {
        log.add({ at, draws: marks, work })
      }
    },
  })
  const stopWatchingDraws = watchDraws(canvas, timer.mark)
  const watch = {
    canvas,
    get exact() {
      return exact
    },
    log,
    /** The screen's refresh rate, in Hz; 0 until enough frames have gone by to tell */
    get refreshRate() {
      return estimateRefreshRate(screenFrames)
    },
    /**
     * While the game is paused nothing is logged, so the log stays as the game left it, to be read in the pause menu.
     * It starts afresh when the game goes on
     */
    setPaused(value: boolean) {
      if (paused && !value) {
        log.clear()
      }
      paused = value
    },
    stop() {
      stopWatchingDraws()
      timer.stop()
      if (current === watch) {
        current = undefined
      }
    },
  }
  current = watch
  return watch
}

export type FrameWatch = ReturnType<typeof watchFrames>

/** The watch on the game being played, if the overlay is on */
export function getFrameWatch() {
  return current
}

interface Renderer {
  /** The graphics chip's name as the browser gives it; some give only a general one */
  gpu?: string
  version: 'WebGL' | 'WebGL2'
}

// Asked once for each game: it doesn't change while the game runs
const renderers = new WeakMap<object, Renderer>()

/**
 * What the game on `watch` is drawn with. Asked of the canvas only once a picture has been seen drawn on it: asking a
 * canvas that has nothing to draw with yet would give it one, in the emulator's place
 */
function getRenderer(watch: FrameWatch): Renderer | undefined {
  if (!watch.exact) {
    return
  }
  const known = renderers.get(watch)
  if (known) {
    return known
  }
  try {
    const webgl2 = watch.canvas.getContext('webgl2')
    const context = webgl2 ?? watch.canvas.getContext('webgl')
    if (!context) {
      return
    }
    const names = context.getExtension('WEBGL_debug_renderer_info')
    const gpu: unknown = context.getParameter(names ? names.UNMASKED_RENDERER_WEBGL : context.RENDERER)
    const renderer: Renderer = {
      gpu: typeof gpu === 'string' && gpu ? gpu : undefined,
      version: webgl2 ? 'WebGL2' : 'WebGL',
    }
    renderers.set(watch, renderer)
    return renderer
  } catch {}
}

/** The device and browser as they are now, around the game on `watch`: what the overlay shows beside its timings */
export function readSystem(watch: FrameWatch, emulator: { getEmscripten: () => unknown }) {
  const { Module } = emulator.getEmscripten() as { Module?: { HEAPU8?: { length: number } } }
  // Chrome's own; other browsers don't say how much memory the page uses
  const { memory } = performance as { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } }
  return {
    audio: getAudioInfo(),
    browserMemory: memory ? { limit: memory.jsHeapSizeLimit, used: memory.usedJSHeapSize } : undefined,
    canvas: { height: watch.canvas.height, width: watch.canvas.width },
    cores: navigator.hardwareConcurrency || undefined,
    emulatorMemory: Module?.HEAPU8?.length,
    /** Whether the page may use threads */
    isolated: globalThis.crossOriginIsolated,
    pixelRatio: globalThis.devicePixelRatio,
    refreshRate: watch.refreshRate,
    renderer: getRenderer(watch),
    viewport: { height: globalThis.innerHeight, width: globalThis.innerWidth },
  }
}

export type SystemReading = ReturnType<typeof readSystem>
