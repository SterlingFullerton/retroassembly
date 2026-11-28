import { type DrawingContext, watchDraws } from './draw-watch.ts'

// Where on its canvas a game's picture is. The canvas fills the window, and the emulator draws the picture as large as
// fits, with black around it; on a phone it also keeps clear of the on-screen controls. Whoever shows the canvas
// somewhere else, on a guest's screen of another shape, wants the picture alone.
//
// The emulator doesn't say where it draws, but its drawing does: the first thing it draws to the screen each frame is
// the picture, in a rectangle it sets beforehand

/** A picture's place on its canvas, each side as a share of the canvas from its top left, and the picture's own shape */
export interface PictureArea {
  /** The picture's width over its height, in the screen's pixels */
  aspect: number
  height: number
  left: number
  top: number
  width: number
}

/**
 * The area a drawing rectangle covers on a canvas of the given size. The rectangle is as the drawing system gives it:
 * left, bottom, width and height in pixels, measured from the canvas's bottom left. Nothing for a rectangle with no
 * area, or a canvas with none
 */
export function toPictureArea(
  rectangle: ArrayLike<number>,
  canvasWidth: number,
  canvasHeight: number,
): PictureArea | undefined {
  const { 0: x, 1: y, 2: width, 3: height } = rectangle
  if (!(width > 0 && height > 0 && canvasWidth > 0 && canvasHeight > 0)) {
    return
  }
  // A rectangle that runs past the canvas is cut to it
  const left = Math.max(0, x)
  const right = Math.min(canvasWidth, x + width)
  const bottom = Math.max(0, y)
  const upper = Math.min(canvasHeight, y + height)
  if (right <= left || upper <= bottom) {
    return
  }
  return {
    aspect: (right - left) / (upper - bottom),
    height: (upper - bottom) / canvasHeight,
    left: left / canvasWidth,
    top: (canvasHeight - upper) / canvasHeight,
    width: (right - left) / canvasWidth,
  }
}

/** Whether two areas are the same to within a thousandth, which no one would see */
export function isSameArea(a: PictureArea | undefined, b: PictureArea | undefined) {
  if (!a || !b) {
    return a === b
  }
  return (['height', 'left', 'top', 'width'] as const).every((side) => Math.abs(a[side] - b[side]) < 0.001)
}

// How often the picture's place is looked at again: it only moves when the window is resized or turned
const lookEvery = 500

/**
 * Tells `onChange` where the picture of the game on `canvas` is, once it's known and whenever it moves, until the
 * function returned is called
 */
export function watchGamePicture(canvas: HTMLCanvasElement, onChange: (area: PictureArea) => void) {
  let known: PictureArea | undefined
  let lookAt = 0

  function look(context: DrawingContext) {
    const now = performance.now()
    // Drawing that isn't to the screen is a step on the way to the picture, and says nothing of where it ends up
    if (now < lookAt || context.getParameter(context.FRAMEBUFFER_BINDING) !== null) {
      return
    }
    lookAt = now + lookEvery
    const area = toPictureArea(context.getParameter(context.VIEWPORT) as Int32Array, canvas.width, canvas.height)
    if (area && !isSameArea(area, known)) {
      known = area
      onChange(area)
    }
  }

  return watchDraws(canvas, look)
}

/**
 * How a video of the whole canvas is laid out to show only the picture: the styles of a box, and of the video in it.
 * `room` is the height the picture may take, in pixels, where it's less than the screen's
 */
export function getPictureLayout(area: PictureArea | undefined, room?: number) {
  if (!area) {
    return
  }
  const height = room === undefined ? '100dvh' : `${room}px`
  return {
    // A box the picture's shape, as large as fits the screen
    box: {
      aspectRatio: String(area.aspect),
      width: `min(100vw, calc(${height} * ${area.aspect}))`,
    },
    // The video is made large enough that the picture fills the box, and moved so the picture's corner is the box's
    video: {
      height: `${100 / area.height}%`,
      left: `${(-area.left / area.width) * 100}%`,
      top: `${(-area.top / area.height) * 100}%`,
      width: `${100 / area.width}%`,
    },
  }
}
