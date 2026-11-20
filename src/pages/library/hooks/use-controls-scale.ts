import { useEffect, useState } from 'react'

// On-screen controls are laid out for a phone 390 points wide. This is how much to shrink them on a smaller screen, so
// they keep their shape instead of running into each other: in portrait by the screen's width, and in landscape by its
// height and by the space beside the game, which fills the height at its own shape, so they don't cover it.
// The bar with pause above the game in portrait
const topBarHeight = 44

interface Tall {
  /** How far down the game starts in landscape */
  gameTop?: number
  /** How tall the controls are at full size in portrait */
  portraitHeight?: number
}

function getControlsScale(sideWidth: number, gameAspectRatio: number, { gameTop = 0, portraitHeight }: Tall) {
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
  const besideGame = (width - (height - gameTop) * gameAspectRatio) / 2
  return Math.max(0.6, Math.min(1, height / 390, besideGame / sideWidth))
}

/**
 * The scale for on-screen controls; `sideWidth` is how wide one side's controls are at full size in landscape,
 * `gameAspectRatio` the shape of the game's picture, and `portraitHeight`, for controls tall enough to reach the game
 * on a short phone, how tall they are at full size in portrait. `gameTop` is how far down the game starts in landscape,
 * where a game moved below the top bar is narrower and leaves more room beside it.
 */
export function useControlsScale(
  sideWidth: number,
  gameAspectRatio = 4 / 3,
  { gameTop = 0, portraitHeight }: Tall = {},
) {
  const [scale, setScale] = useState(() => getControlsScale(sideWidth, gameAspectRatio, { gameTop, portraitHeight }))

  useEffect(() => {
    function update() {
      setScale(getControlsScale(sideWidth, gameAspectRatio, { gameTop, portraitHeight }))
    }
    update()
    const abortController = new AbortController()
    globalThis.addEventListener('resize', update, { signal: abortController.signal })
    return () => abortController.abort()
  }, [sideWidth, gameAspectRatio, portraitHeight, gameTop])

  return scale
}
