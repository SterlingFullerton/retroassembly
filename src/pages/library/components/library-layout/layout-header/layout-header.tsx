import { Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
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
  const { consolesLink, groups, isActive } = useNavigationLinks()
  const { isNotLargeScreen } = useViewport()
  const { t } = useTranslation()
  const { clear, query } = useLibrarySearch()
  const openSearch = useOpenPhoneSearch()

  // The menu here picks a console: Home, Games, Consoles, Favorites and History are in the bar at the bottom
  const consoleLinks = groups.at(-1)?.links ?? []
  const currentLink = consoleLinks.find(({ to }) => isActive(to))
  const currentRouteName = currentLink?.name
  // Off a console's page it reads as a prompt, not as the page's name
  const pickerLabel = currentLink ?? { ...consolesLink, text: t('nav.pickConsole') }

  async function handleValueChange(value: string) {
    const link = consoleLinks.find(({ name }) => name === value)
    if (link?.to) {
      await navitate(withSearch(link.to, query))
    }
  }

  return (
    <>
      <header className='px-safe-offset-2 fixed inset-x-0 top-0 z-2 flex items-center gap-1 bg-(--accent-9) py-1 lg:hidden'>
        <UploadBadge className='absolute inset-x-0 top-full flex items-center justify-center gap-2 bg-(--accent-9) py-1 text-xs text-white' />

        <Link className='flex shrink-0 items-center gap-2 font-bold' data-sn-skip='' to={routes.libraryHome}>
          <Logo height='32' width='32' />
        </Link>

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
          <>
            <div className='flex h-5 flex-1 justify-center'>
              <Select.Root onValueChange={handleValueChange} size='2' value={currentRouteName ?? ''}>
                {/* Shown as the placeholder too, for when the page isn't a console's (typed as text, but shown as given) */}
                <Select.Trigger
                  // White as a console's name is, though shown as a placeholder (which is otherwise grey, lost on red)
                  className='text-white! [&_.rt-SelectTriggerInner]:text-white!'
                  placeholder={(<HeaderLinkItem link={pickerLabel} />) as unknown as string}
                  variant='ghost'
                >
                  <HeaderLinkItem link={pickerLabel} />
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

            <button
              aria-label={t('common.search')}
              className='grid size-10 shrink-0 place-items-center text-white'
              onClick={() => openSearch('')}
              title={t('common.search')}
              type='button'
            >
              <span className='icon-[mdi--magnify] size-6' />
            </button>
          </>
        )}

        <div className='size-10 shrink-0'>{isNotLargeScreen ? <LayoutMenu inBar /> : null}</div>
      </header>
      <div className='h-12 w-full bg-(--accent-9) lg:hidden' />
    </>
  )
}
