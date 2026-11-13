import { type CSSProperties, useCallback } from 'react'
import { useFocusIndicatorStyle } from '../atoms.ts'

export function useFocusIndicator() {
  const [focusIndicatorStyle, setFocusIndicatorStyle] = useFocusIndicatorStyle()

  const syncStyle = useCallback(
    ({ transition = true }: { transition?: boolean } = {}) => {
      const { activeElement } = document
      if (activeElement instanceof HTMLElement && activeElement.dataset.snEnabled) {
        // A control inside a larger one, such as the volume slider in its row, can have the indicator drawn around that
        const box = (activeElement.dataset.snFocusParent && activeElement.parentElement) || activeElement
        const { height, left, top, width } = box.getBoundingClientRect()
        const focusIndicatorStyle: CSSProperties = { height, left, top, width }
        if (transition) {
          focusIndicatorStyle.transitionProperty = 'all'
          focusIndicatorStyle.transitionDuration = '0.2s'
        }
        try {
          const customStyle = activeElement.dataset.snFocusStyle
          if (customStyle) {
            Object.assign(focusIndicatorStyle, JSON.parse(customStyle))
          }
        } catch {}
        setFocusIndicatorStyle(focusIndicatorStyle)
      } else {
        setFocusIndicatorStyle({})
      }
    },
    [setFocusIndicatorStyle],
  )
  return { style: focusIndicatorStyle, syncStyle }
}
