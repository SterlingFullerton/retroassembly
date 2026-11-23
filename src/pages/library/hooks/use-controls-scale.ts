import { useEffect, useState } from 'react'

// On-screen controls are laid out for a phone 390 points wide. This is how much to shrink them on a smaller screen, so
// they keep their shape instead of running into each other: in portrait by the screen's width, and in landscape by its
// height. They never shrink to stay clear of the game: in landscape they sit over its edges where there's no room
// beside it, since buttons too small to press are worse than a covered edge.
// The bar with pause above the game in portrait
const topBarHeight = 44

// A tablet, such as an iPad: its shorter side is at least this many points (the `tablet:` class variant says the same).
// Its controls are drawn a bit larger than a phone's, for thumbs reaching in from the sides of a bigger screen
const tabletSide = 600
const tabletScale = 1.2

// Controls taller than the room below the game in portrait shrink to fit it, but no further than this: past it, they
// go over the foot of the game instead
const smallestFit = 0.92

interface Tall {
  /** How tall the controls are at full size in portrait */
  portraitHeight?: number
}

function getControlsScale(gameAspectRatio: number, { portraitHeight }: Tall) {
  if (globalThis.innerWidth === undefined) {
    return 1
  }
  const width = globalThis.innerWidth
  const height = globalThis.innerHeight
  const tablet = Math.min(width, height) >= tabletSide
  if (width <= height) {
    // Controls taller than most also shrink to fit below the game, which fills the width at its own shape
    const belowGame = height - topBarHeight - width / gameAspectRatio
    const fit = portraitHeight ? belowGame / portraitHeight : Infinity
    return tablet ? Math.max(1, Math.min(tabletScale, fit)) : Math.min(1, width / 390, Math.max(smallestFit, fit))
  }
  return tablet ? tabletScale : Math.min(1, height / 390)
}

/**
 * The scale for on-screen controls; `gameAspectRatio` is the shape of the game's picture and `portraitHeight`, for
 * controls tall enough to reach the game on a short phone, how tall they are at full size in portrait
 */
export function useControlsScale(gameAspectRatio = 4 / 3, { portraitHeight }: Tall = {}) {
  const [scale, setScale] = useState(() => getControlsScale(gameAspectRatio, { portraitHeight }))

  useEffect(() => {
    function update() {
      setScale(getControlsScale(gameAspectRatio, { portraitHeight }))
    }
    update()
    const abortController = new AbortController()
    globalThis.addEventListener('resize', update, { signal: abortController.signal })
    return () => abortController.abort()
  }, [gameAspectRatio, portraitHeight])

  return scale
}
