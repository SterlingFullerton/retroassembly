import { Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import { Logo } from '#@/pages/components/logo.tsx'
import { useViewport } from '#@/pages/library/hooks/use-viewport.ts'
import { routes } from '#@/pages/routes.ts'
import { useLibrarySearch, withSearch } from '../../../hooks/use-library-search.ts'
import { useNavigationLinks } from '../../../hooks/use-navigation-links.ts'
import { LayoutMenu } from '../layout-menu/layout-menu.tsx'
import { useOpenPhoneSearch } from '../phone-search/phone-search-screen.tsx'
import { UploadBadge } from '../upload-badge.tsx'
import { HeaderLinkItem } from './header-link-item.tsx'

export function LayoutHeader() {
  const navitate = useNavigate()
  const { groups, isActive } = useNavigationLinks()
  const { isNotLargeScreen } = useViewport()
  const { t } = useTranslation()
  const { clear, query } = useLibrarySearch()
  const openSearch = useOpenPhoneSearch()

  // On a console's page, and a game's, the bar shows that console and switches to another. Elsewhere it shows the app's
  // name: consoles are chosen from the Consoles tab in the bar at the bottom, the one way to them on a phone
  const consoleLinks = groups.at(-1)?.links ?? []
  const currentLink = consoleLinks.find(({ to }) => isActive(to))
  const currentRouteName = currentLink?.name

  // On the lists of games, of consoles, favorites and history, the bar names the page: on a phone they have no title of
  // their own. Elsewhere it shows the app's name
  const { pathname } = useLocation()
  const pageNames: Record<string, string> = {
    [routes.libraryConsoles]: t('nav.consoles'),
    [routes.libraryFavorites]: t('nav.favorites'),
    [routes.libraryHistory]: t('nav.history'),
    [routes.libraryRoms]: t('common.games'),
  }
  const pageName = pathname.startsWith(routes.librarySettings)
    ? t('nav.settings')
    : pageNames[pathname.replace(/\/$/u, '')]

  async function handleValueChange(value: string) {
    const link = consoleLinks.find(({ name }) => name === value)
    if (link?.to) {
      await navitate(withSearch(link.to, query))
    }
  }

  // The current console, to switch to another, or the page's name
  const title = currentLink ? (
    <div className='flex h-5 min-w-0 flex-1 justify-center'>
      <Select.Root onValueChange={handleValueChange} size='2' value={currentRouteName ?? ''}>
        {/* Shown as the placeholder too (typed as text, but shown as given) */}
        <Select.Trigger
          // White as a console's name is, though shown as a placeholder (which is otherwise grey, lost on red)
          // A long console name is shortened on a small phone, so it stays clear of the buttons
          className='max-w-full! shrink! text-white! [&_.rt-SelectTriggerInner]:min-w-0 [&_.rt-SelectTriggerInner]:text-white! [&_.rt-SelectTriggerInner>span]:block'
          placeholder={(<HeaderLinkItem inBar link={currentLink} />) as unknown as string}
          variant='ghost'
        >
          <HeaderLinkItem inBar link={currentLink} />
        </Select.Trigger>
        <Select.Content>
          {consoleLinks.map((link) => (
            <Select.Item key={link.name} value={link.name}>
              <HeaderLinkItem link={link} />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  ) : (
    <div className='flex min-w-0 flex-1 justify-center font-semibold text-white'>
      {pageName ? (
        <span className='truncate text-lg'>{pageName}</span>
      ) : (
        <span className='font-serif'>{metadata.title}</span>
      )}
    </div>
  )

  return (
    <>
      <header className='px-safe-offset-2 fixed inset-x-0 top-0 z-2 flex items-center gap-1 bg-(--accent-9) py-1 lg:hidden'>
        <UploadBadge className='absolute inset-x-0 top-full flex items-center justify-center gap-2 bg-(--accent-9) py-1 text-xs text-white' />

        {/* The logo's side is as wide as the buttons' side, so what's between them is centred on the screen */}
        <div className='flex w-20 shrink-0'>
          <Link className='flex shrink-0 items-center gap-2 font-bold' data-sn-skip='' to={routes.libraryHome}>
            <Logo height='32' width='32' />
          </Link>
        </div>

        {query ? (
          // A search is on: shown in the bar so it's never on unseen. Tapping it opens the search screen with it, the x
          // ends it
          <div className='flex min-w-0 flex-1 justify-center'>
            <div className='flex h-8 max-w-full min-w-0 items-center rounded-full bg-white/20 text-sm text-white'>
              <button
                className='flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-3'
                onClick={() => openSearch(query)}
                type='button'
              >
                <span className='icon-[mdi--magnify] size-4 shrink-0' />
                <span className='truncate'>{query}</span>
              </button>
              <button
                aria-label={t('common.clear')}
                className='grid size-8 shrink-0 place-items-center'
                onClick={clear}
                title={t('common.clear')}
                type='button'
              >
                <span className='icon-[mdi--close] size-4' />
              </button>
            </div>
          </div>
        ) : (
          title
        )}

        <div className='flex w-20 shrink-0 justify-end'>
          {query ? null : (
            <button
              aria-label={t('common.search')}
              className='grid size-10 shrink-0 place-items-center text-white'
              onClick={() => openSearch('')}
              title={t('common.search')}
              type='button'
            >
              <span className='icon-[mdi--magnify] size-6' />
            </button>
          )}
          <div className='size-10 shrink-0'>{isNotLargeScreen ? <LayoutMenu large /> : null}</div>
        </div>
      </header>
      <div className='h-12 w-full bg-(--accent-9) lg:hidden' />
    </>
  )
}
