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

/** Wraps one drawing function all 3D canvases of a kind share; the function returned puts it back */
function watchDrawCall(prototype: Record<string, unknown>, name: string, onDraw: (context: DrawingContext) => void) {
  const original = prototype[name] as DrawCall
  function watched(this: DrawingContext, ...args: unknown[]) {
    onDraw(this)
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
 * Has `onDraw` called just before anything is drawn on `canvas`, with what's drawing it, until the function it returns
 * is called
 */
export function watchDraws(canvas: HTMLCanvasElement, onDraw: (context: DrawingContext) => void) {
  function handleDraw(context: DrawingContext) {
    if (context.canvas === canvas) {
      onDraw(context)
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
