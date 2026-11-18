import { type CSSProperties, useCallback } from 'react'
import { useFocusIndicatorStyle } from '../atoms.ts'
import { isNavigable } from '../utils/spatial-navigation.ts'

type Placement = 'fixed' | 'page' | 'sticky'

// Where the focused element sits decides how the indicator keeps up with scrolling. On the page, the indicator is placed
// on the page too and scrolls along by itself. In a fixed box, such as the sidebar or a game's menu, it's fixed as well.
// A sticky box moves with the page only part of the way, so it's measured again as the page scrolls
let placement: Placement = 'page'
let frame = 0

function getPlacement(element: Element): Placement {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const { position } = getComputedStyle(node)
    if (position === 'fixed') {
      return 'fixed'
    }
    if (position === 'sticky') {
      return 'sticky'
    }
  }
  return 'page'
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function useFocusIndicator() {
  const [focusIndicatorStyle, setFocusIndicatorStyle] = useFocusIndicatorStyle()

  const syncStyle = useCallback(
    ({ transition = true }: { transition?: boolean } = {}) => {
      const { activeElement } = document
      if (!isNavigable(activeElement)) {
        setFocusIndicatorStyle({})
        return
      }
      // A control inside a larger one, such as the volume slider in its row, can have the indicator drawn around that
      const box = (activeElement.dataset.snFocusParent && activeElement.parentElement) || activeElement
      const { height, left, top, width } = box.getBoundingClientRect()
      placement = getPlacement(box)
      const onPage = placement !== 'fixed'
      const x = left + (onPage ? scrollX : 0)
      const y = top + (onPage ? scrollY : 0)
      const style: CSSProperties = {
        height,
        left: 0,
        position: onPage ? 'absolute' : 'fixed',
        top: 0,
        // Moved by transform, which the browser animates without laying out the page on every frame
        transform: `translate(${x}px, ${y}px)`,
        transition:
          transition && !prefersReducedMotion()
            ? 'transform 150ms ease-out, width 150ms ease-out, height 150ms ease-out'
            : 'none',
        width,
      }
      try {
        const customStyle = activeElement.dataset.snFocusStyle
        if (customStyle) {
          Object.assign(style, JSON.parse(customStyle))
        }
      } catch {}
      setFocusIndicatorStyle(style)
    },
    [setFocusIndicatorStyle],
  )

  // Once a frame at most. A row scrolling sideways moves its games under the indicator, which follows them smoothly. The
  // page scrolling needs nothing unless the focus is in a sticky box
  const syncAfterScroll = useCallback(
    (target: EventTarget | null) => {
      const pageScrolled = target === document || target === document.documentElement
      if (pageScrolled && placement !== 'sticky') {
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => syncStyle({ transition: !pageScrolled }))
    },
    [syncStyle],
  )

  return { style: focusIndicatorStyle, syncAfterScroll, syncStyle }
}
