import { Provider } from 'jotai'
import { HydrationBoundary } from 'jotai-ssr'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Scripts, ScrollRestoration, useRouteLoaderData } from 'react-router'
import type { clientLoader as loader } from '#@/pages/root.tsx'
import { i18n } from '#@/utils/isomorphic/i18n.ts'
import { getGlobalCSSVars } from '#@/utils/isomorphic/misc.ts'
import { preferenceAtom } from '../atoms.ts'
import { Head } from './head.tsx'
import { RadixTheme } from './radix-theme.tsx'

export function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Missing while the page is built, and in the browser until the data every page shares has loaded
  const data = useRouteLoaderData<typeof loader>('root')
  const hydrateAtoms = [[preferenceAtom, data?.preference] as const]

  return (
    <html lang={data?.language} prefix='og: https://ogp.me/ns#' suppressHydrationWarning>
      <I18nextProvider i18n={i18n}>
        <Head />
      </I18nextProvider>
      <body className='bg-(--primary) 2xl:bg-none' style={getGlobalCSSVars(data?.preference)}>
        <I18nextProvider i18n={i18n}>
          <RadixTheme>
            <ThemeProvider attribute='class'>
              {/* The settings are put in the page's store once, so only after they've loaded */}
              {data ? (
                <Provider>
                  <HydrationBoundary hydrateAtoms={hydrateAtoms}>{children}</HydrationBoundary>
                </Provider>
              ) : (
                children
              )}
            </ThemeProvider>
          </RadixTheme>
        </I18nextProvider>
        <ScrollRestoration getKey={({ pathname, search }) => `${pathname}${search}`} />
        <Scripts />
      </body>
    </html>
  )
}
