// Watching what's drawn on a game's canvas, from outside the emulator. The drawing functions all 3D canvases share are
// wrapped while something watches, which asks nothing of the canvas or the emulator

// What draws a picture on a 3D canvas. Every emulator ends a frame it shows with one of these, and makes none in a frame
// it lets pass
const drawCalls = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']

/** What draws on a 3D canvas, as far as watching it needs */
export type DrawingContext = WebGL2RenderingContext | WebGLRenderingContext

function getContextPrototypes() {
  return [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]
    .filter((context) => typeof context === 'function')
    .map((context) => context.prototype as unknown as Record<string, unknown>)
}

type DrawCall = (this: DrawingContext, ...args: unknown[]) => unknown

// Everything watching, each told of every draw. The drawing functions are wrapped once, however many watch, and put
// back when the last stops: watchers that stop in any order leave nothing behind
const watchers = new Set<(context: DrawingContext) => void>()
const wrapped: { name: string; original: DrawCall; prototype: Record<string, unknown>; watched: DrawCall }[] = []

function wrapDrawCall(prototype: Record<string, unknown>, name: string) {
  const original = prototype[name] as DrawCall
  function watched(this: DrawingContext, ...args: unknown[]) {
    for (const watcher of watchers) {
      watcher(this)
    }
    return Reflect.apply(original, this, args)
  }
  prototype[name] = watched
  wrapped.push({ name, original, prototype, watched })
}

function wrapDrawCalls() {
  for (const prototype of getContextPrototypes()) {
    for (const name of drawCalls) {
      if (typeof prototype[name] === 'function' && Object.hasOwn(prototype, name)) {
        wrapDrawCall(prototype, name)
      }
    }
  }
}

function unwrapDrawCalls() {
  for (const { name, original, prototype, watched } of wrapped.splice(0)) {
    // Left in place if something else has wrapped it since
    if (prototype[name] === watched) {
      prototype[name] = original
    }
  }
}

/**
 * Has `onDraw` called just before anything is drawn on `canvas`, with what's drawing it, until the function it returns
 * is called
 */
export function watchDraws(canvas: HTMLCanvasElement, onDraw: (context: DrawingContext) => void) {
  function handleDraw(context: DrawingContext) {
    if (context.canvas === canvas) {
      onDraw(context)
    }
  }
  if (watchers.size === 0) {
    wrapDrawCalls()
  }
  watchers.add(handleDraw)
  return () => {
    if (watchers.delete(handleDraw) && watchers.size === 0) {
      unwrapDrawCalls()
    }
  }
}
