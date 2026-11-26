import { useTranslation } from 'react-i18next'
import { generatePath, useLocation } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import { routes } from '#@/pages/routes.ts'
import { getPlatformIcon } from '#@/utils/client/library.ts'
import { usePlatform } from './use-platform.ts'
import { usePreference } from './use-preference.ts'

function getPlatformLink(platform?: string) {
  if (!platform) {
    return ''
  }
  return generatePath(routes.libraryPlatform, { platform })
}

export function useNavigationLinks() {
  const { i18n, t } = useTranslation()
  const { preference } = usePreference()
  const platform = usePlatform()
  const location = useLocation()
  const { platforms } = preference.ui

  const platformLinks = platforms.map((platform) => ({
    iconClass: '',
    iconUrl: getPlatformIcon(platform),
    name: platform,
    text: t(platformMap[platform].displayNameI18nKey),
    to: getPlatformLink(platform),
  }))

  // A to Z by the names shown, in the reader's language, so a console is quick to find in the list
  const sortedPlatformLinks = platformLinks.toSorted((a, b) => a.text.localeCompare(b.text, i18n.language))

  const groups = [
    {
      links: [
        {
          iconClass: 'icon-[mdi--home]',
          iconUrl: '',
          name: 'home',
          text: t('nav.home'),
          to: generatePath(routes.libraryHome),
        },
        {
          iconClass: 'icon-[mdi--bookshelf]',
          iconUrl: '',
          name: 'library',
          text: t('common.games'),
          to: generatePath(routes.libraryRoms),
        },
        {
          iconClass: 'icon-[mdi--heart]',
          iconUrl: '',
          name: 'favorites',
          text: t('nav.favorites'),
          to: generatePath(routes.libraryFavorites),
        },
        {
          iconClass: 'icon-[mdi--history]',
          iconUrl: '',
          name: 'history',
          text: t('nav.history'),
          to: generatePath(routes.libraryHistory),
        },
      ],
      title: '',
    },
    { links: sortedPlatformLinks, title: t('nav.consoles') },
  ]

  // The page with every console, reached from the consoles' heading (a computer) or the top of their menu (a phone)
  const consolesLink = {
    iconClass: 'icon-[mdi--gamepad-classic]',
    iconUrl: '',
    name: 'consoles',
    text: t('nav.allConsoles'),
    to: generatePath(routes.libraryConsoles),
  }

  function isActive(link: string) {
    return location.pathname === link || getPlatformLink(platform?.name) === link
  }

  return { consolesLink, groups, isActive }
}
