import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useNavigationLinks } from '../../../hooks/use-navigation-links.ts'
import { NavigatableLink } from '../../navigatable-link.tsx'

/** "Consoles", above the console list and staying put while it scrolls, a way to the page with every console */
export function SidebarConsolesHeading() {
  const { t } = useTranslation()
  const { consolesLink } = useNavigationLinks()
  const { pathname } = useLocation()
  const active = pathname === consolesLink.to

  return (
    <NavigatableLink
      data-sn-section=''
      className={clsx('mb-2 flex w-64 items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white', {
        'bg-black/50': active,
        'hover:bg-white/10': !active,
      })}
      data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(0, 0, 0, 0.2)' })}
      to={consolesLink.to}
    >
      <span className='icon-[mdi--gamepad-classic] size-5 p-0.5' />
      {t('nav.consoles')}
      <span className='ml-auto flex items-center text-xs font-medium opacity-80'>
        {t('nav.seeAllConsoles')}
        <span className='icon-[mdi--chevron-right] size-4' />
      </span>
    </NavigatableLink>
  )
}
