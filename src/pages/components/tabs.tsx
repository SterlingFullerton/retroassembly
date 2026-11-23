import { Tabs as ThemeTabs } from '@radix-ui/themes'
import type { ComponentProps } from 'react'

// The app's tabs. Radix opens a tab as soon as it's focused, and here the mouse moves the focus as it passes over
// things (as a controller's stick does), so its tabs would open under a passing mouse. These open only when pressed:
// with a click, Enter, Space or a controller's confirm button. Every tab bar uses these, which
// tests/unit/tabs.test.ts checks

function Root(props: Readonly<ComponentProps<typeof ThemeTabs.Root>>) {
  return <ThemeTabs.Root activationMode='manual' {...props} />
}

export const Tabs = { Content: ThemeTabs.Content, List: ThemeTabs.List, Root, Trigger: ThemeTabs.Trigger }
