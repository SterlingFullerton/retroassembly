import { clsx } from 'clsx'
import { type ReactNode, useLayoutEffect } from 'react'
import { useLocation } from 'react-router'
import { RadixThemePortal } from '#@/pages/components/radix-theme-portal.tsx'
import { useFocusIndicator } from '../../hooks/use-focus-indicator.ts'
import { useGamepads } from '../../hooks/use-gamepads.ts'
import { usePreference } from '../../hooks/use-preference.ts'
import { useSpatialNavigation } from '../../hooks/use-spatial-navigation.ts'

export function FocusIndicator({ children }: { readonly children?: ReactNode }) {
  const { connected } = useGamepads()
  const { style, syncStyle } = useFocusIndicator()
  const location = useLocation()

  const { pristine } = useSpatialNavigation()
  const { preference } = usePreference()

  // A new page puts the indicator straight on its first focus, rather than sliding it over from the last page
  useLayoutEffect(() => {
    if (location.pathname) {
      syncStyle({ transition: false })
    }
  }, [location.pathname, syncStyle])

  if (preference.ui.showFocusIndicators === 'never') {
    return
  }

  if (pristine || style.width === undefined) {
    return
  }

  return (
    <RadixThemePortal>
      <div
        className={clsx(
          'pointer-events-none z-10 rounded bg-(--accent-9)/10 ring-2 ring-(--accent-11)/70 in-[.dark]:bg-white/10',
          { 'hidden lg:block': !connected },
        )}
        style={style}
      >
        {children}
      </div>
    </RadixThemePortal>
  )
}
