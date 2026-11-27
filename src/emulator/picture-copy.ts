import { watchDraws } from './draw-watch.ts'
import type { PictureArea } from './game-picture.ts'

// The game's picture alone, copied off its canvas each time the emulator draws, for sending to a guest. The canvas
// fills the host's window, with black around the picture, and on a phone it's tall, with room for the on-screen
// controls: sending all of it had a phone encode twice the picture there was. The copy is the picture, no taller than a
// guest needs, and is sent once per frame the game draws.
//
// A 3D canvas's picture is only there to copy until the browser shows it, so the copy is taken straight after the
// emulator's drawing, before anything else runs

/** Where the copy is taken from, in the canvas's pixels, and the size it's made */
export interface CopySize {
  height: number
  sourceHeight: number
  sourceLeft: number
  sourceTop: number
  sourceWidth: number
  width: number
}

function even(value: number) {
  // Video encoders work in pairs of pixels, and some refuse an odd size
  return Math.max(2, 2 * Math.round(value / 2))
}

/**
 * The part of `canvas` to copy, the picture in `area` or all of it while that isn't
 * known, and the size to copy it at: as it is, or `tallest` lines high when it's taller
 */
export function getCopySize(
  area: PictureArea | undefined,
  canvas: { height: number; width: number },
  tallest: number,
): CopySize {
  const { height: canvasHeight, width: canvasWidth } = canvas
  const sourceLeft = Math.round((area?.left ?? 0) * canvasWidth)
  const sourceTop = Math.round((area?.top ?? 0) * canvasHeight)
  const sourceWidth = Math.max(1, Math.round((area?.width ?? 1) * canvasWidth))
  const sourceHeight = Math.max(1, Math.round((area?.height ?? 1) * canvasHeight))
  const scale = Math.min(1, tallest / sourceHeight)
  return {
    height: even(sourceHeight * scale),
    sourceHeight,
    sourceLeft,
    sourceTop,
    sourceWidth,
    width: even(sourceWidth * scale),
  }
}

interface CapturedTrack extends MediaStreamTrack {
  requestFrame?: () => void
}

/**
 * Starts copying the game on `canvas`. `stream` has the copy as its picture; `setArea()` says where the picture is, as it
 * becomes known or moves. `copies` counts the copies made, none meaning the emulator draws somewhere this can't see
 */
export function copyGamePicture(canvas: HTMLCanvasElement, tallest: number) {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d', { alpha: false })
  // Asked for a frame each copy, where the browser can, so each frame of the game is sent once, and only then
  const stream = copy.captureStream(0)
  const [track] = stream.getVideoTracks() as CapturedTrack[]
  const exact = typeof track?.requestFrame === 'function'
  if (!exact) {
    for (const old of stream.getTracks()) {
      old.stop()
    }
  }
  const sent = exact ? stream : copy.captureStream(60)

  let area: PictureArea | undefined
  let pending = false
  let copies = 0
  let stopped = false

  function take() {
    pending = false
    if (stopped || !context) {
      return
    }
    const size = getCopySize(area, canvas, tallest)
    if (copy.width !== size.width || copy.height !== size.height) {
      copy.width = size.width
      copy.height = size.height
    }
    try {
      context.drawImage(
        canvas,
        size.sourceLeft,
        size.sourceTop,
        size.sourceWidth,
        size.sourceHeight,
        0,
        0,
        size.width,
        size.height,
      )
    } catch {
      return
    }
    copies += 1
    if (exact) {
      track?.requestFrame?.()
    }
  }

  const stopWatching = watchDraws(canvas, () => {
    // Taken once the emulator's done drawing this frame: after its code has run, before the browser shows the picture
    if (!pending && !stopped) {
      pending = true
      queueMicrotask(take)
    }
  })

  return {
    get copies() {
      return copies
    },
    setArea(found: PictureArea) {
      area = found
    },
    stop() {
      stopped = true
      stopWatching()
      for (const each of [...stream.getTracks(), ...sent.getTracks()]) {
        each.stop()
      }
    },
    stream: sent,
  }
}
