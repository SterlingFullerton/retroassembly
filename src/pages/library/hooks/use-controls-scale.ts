import { useEffect, useState } from 'react'

// On-screen controls are laid out for a phone 390 points wide. This is how much to shrink them on a smaller screen, so
// they keep their shape instead of running into each other: in portrait by the screen's width, and in landscape by its
// height and by the space beside the game, which fills the height at its own shape, so they don't cover it.
// The bar with pause above the game in portrait
const topBarHeight = 44

function getControlsScale(sideWidth: number, gameAspectRatio: number, portraitHeight?: number) {
  if (globalThis.innerWidth === undefined) {
    return 1
  }
  const width = globalThis.innerWidth
  const height = globalThis.innerHeight
  if (width <= height) {
    // Controls taller than most also shrink to fit below the game, which fills the width at its own shape
    const belowGame = height - topBarHeight - width / gameAspectRatio
    return Math.min(1, width / 390, portraitHeight ? belowGame / portraitHeight : 1)
  }
  const besideGame = (width - height * gameAspectRatio) / 2
  return Math.max(0.6, Math.min(1, height / 390, besideGame / sideWidth))
}

/**
 * The scale for on-screen controls; `sideWidth` is how wide one side's controls are at full size in landscape,
 * `gameAspectRatio` the shape of the game's picture, and `portraitHeight`, for controls tall enough to reach the game
 * on a short phone, how tall they are at full size in portrait.
 */
export function useControlsScale(sideWidth: number, gameAspectRatio = 4 / 3, portraitHeight?: number) {
  const [scale, setScale] = useState(() => getControlsScale(sideWidth, gameAspectRatio, portraitHeight))

  useEffect(() => {
    function update() {
      setScale(getControlsScale(sideWidth, gameAspectRatio, portraitHeight))
    }
    update()
    const abortController = new AbortController()
    globalThis.addEventListener('resize', update, { signal: abortController.signal })
    return () => abortController.abort()
  }, [sideWidth, gameAspectRatio, portraitHeight])

  return scale
}
