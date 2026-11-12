import { useEffect, useState } from 'react'

// On-screen controls are laid out for a phone 390 points wide. This is how much to shrink them on a smaller screen, so
// they keep their shape instead of running into each other: in portrait by the screen's width, and in landscape by its
// height and by the space beside the game, which fills the height at its own shape, so they don't cover it.
function getControlsScale(sideWidth: number, gameAspectRatio: number) {
  if (globalThis.innerWidth === undefined) {
    return 1
  }
  const width = globalThis.innerWidth
  const height = globalThis.innerHeight
  if (width <= height) {
    return Math.min(1, width / 390)
  }
  const besideGame = (width - height * gameAspectRatio) / 2
  return Math.max(0.6, Math.min(1, height / 390, besideGame / sideWidth))
}

/**
 * The scale for on-screen controls; `sideWidth` is how wide one side's controls are at full size in landscape, and
 * `gameAspectRatio` the shape of the game's picture.
 */
export function useControlsScale(sideWidth: number, gameAspectRatio = 4 / 3) {
  const [scale, setScale] = useState(() => getControlsScale(sideWidth, gameAspectRatio))

  useEffect(() => {
    function update() {
      setScale(getControlsScale(sideWidth, gameAspectRatio))
    }
    update()
    const abortController = new AbortController()
    globalThis.addEventListener('resize', update, { signal: abortController.signal })
    return () => abortController.abort()
  }, [sideWidth, gameAspectRatio])

  return scale
}
