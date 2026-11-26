import { createFrameLog, timeAnimationFrames } from './perf.ts'

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

// What draws a picture on a 3D canvas. Every emulator ends a frame it shows with one of these, and makes none in a frame
// it lets pass
const drawCalls = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']

function getContextPrototypes() {
  return [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]
    .filter((context) => typeof context === 'function')
    .map((context) => context.prototype as unknown as Record<string, unknown>)
}

type DrawCall = (this: { canvas?: unknown }, ...args: unknown[]) => unknown

/** Wraps one drawing function all 3D canvases of a kind share; the function returned puts it back */
function watchDrawCall(prototype: Record<string, unknown>, name: string, onDraw: (canvas: unknown) => void) {
  const original = prototype[name] as DrawCall
  function watched(this: { canvas?: unknown }, ...args: unknown[]) {
    onDraw(this.canvas)
    return Reflect.apply(original, this, args)
  }
  prototype[name] = watched
  return () => {
    // Left in place if something else has wrapped it since
    if (prototype[name] === watched) {
      prototype[name] = original
    }
  }
}

/**
 * Has `onDraw` called whenever something is drawn on `canvas`, until the function it returns is called. The drawing
 * functions all 3D canvases share are wrapped meanwhile, which asks nothing of the canvas itself
 */
function watchDraws(canvas: HTMLCanvasElement, onDraw: () => void) {
  function handleDraw(drawnOn: unknown) {
    if (drawnOn === canvas) {
      onDraw()
    }
  }
  const restores: (() => void)[] = []
  for (const prototype of getContextPrototypes()) {
    for (const name of drawCalls) {
      if (typeof prototype[name] === 'function' && Object.hasOwn(prototype, name)) {
        restores.push(watchDrawCall(prototype, name, handleDraw))
      }
    }
  }
  return () => {
    for (const restore of restores) {
      restore()
    }
  }
}

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
  let exact = false
  let paused = false
  const timer = timeAnimationFrames(globalThis, {
    onFrame(sample, marked) {
      if (paused) {
        return
      }
      if (marked && !exact) {
        // The first picture seen drawn: what was counted before it was the screen's frames
        exact = true
        log.clear()
      }
      if (marked || !exact) {
        log.add(sample)
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
