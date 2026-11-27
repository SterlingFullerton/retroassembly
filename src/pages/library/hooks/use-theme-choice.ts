import { useTheme } from 'next-themes'

export type ThemeChoice = 'dark' | 'light' | 'system'

/** The theme chosen on this device, as the menu and Settings both show and change it */
export function useThemeChoice() {
  const { setTheme, systemTheme, theme } = useTheme()

  function chooseTheme(choice: ThemeChoice) {
    if (choice === 'system') {
      localStorage.removeItem('theme')
    } else {
      localStorage.setItem('theme', choice)
    }
    setTheme(choice)
  }

  return { chooseTheme, systemTheme, theme: (theme ?? 'system') as ThemeChoice }
}
