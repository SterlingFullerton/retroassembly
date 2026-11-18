import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useEmulatorLaunched } from '../../atoms.ts'
import { withSearch } from '../../hooks/use-library-search.ts'
import { useNavigationLinks } from '../../hooks/use-navigation-links.ts'
import { usePlatform } from '../../hooks/use-platform.ts'
import { useSearchQuery } from './atoms.ts'

/**
 * On a phone, Home, Games, Consoles, Favorites and History in a bar pinned to the bottom, a tap away however far down
 * the page is scrolled. On a console's page, or a game's, Consoles is lit
 */
export function PhoneNavBar() {
  const { t } = useTranslation()
  const { consolesLink, groups, isActive } = useNavigationLinks()
  const platform = usePlatform()
  const [query] = useSearchQuery()
  const [launched] = useEmulatorLaunched()
  const [{ links: pageLinks }] = groups
  const links = [...pageLinks.slice(0, 2), { ...consolesLink, text: t('nav.consoles') }, ...pageLinks.slice(2)]

  // Not while a game runs: Safari colours the strip at the bottom of the screen from a bar pinned there, even under the
  // game, and it should be black
  if (launched) {
    return null
  }

  return (
    <nav className='px-safe pb-safe fixed inset-x-0 bottom-0 z-2 flex bg-(--accent-9) text-white shadow-[0_-2px_8px_rgb(0_0_0/0.12)] lg:hidden'>
      {links.map(({ iconClass, name, text, to }) => {
        const active = isActive(to) || (name === 'consoles' && Boolean(platform))
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={clsx('flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs', {
              'font-bold': active,
              'opacity-75': !active,
            })}
            key={name}
            to={withSearch(to, query)}
          >
            <span className={clsx('grid place-items-center rounded-xl px-3.5 py-0.5', { 'bg-white/20': active })}>
              <span className={clsx('size-6', iconClass)} />
            </span>
            {text}
          </Link>
        )
      })}
    </nav>
  )
}
