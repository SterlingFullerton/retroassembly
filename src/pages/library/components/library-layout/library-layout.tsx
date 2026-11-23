import { ScrollArea } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { PropsWithChildren } from 'react'
import { Link } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import { Logo } from '#@/pages/components/logo.tsx'
import { usePageTitle } from '#@/pages/library/hooks/use-library-data.ts'
import { routes } from '#@/pages/routes.ts'
import { useCrossOriginIsolatedNavigation } from '../../hooks/use-cross-origin-isolated-navigation.ts'
import { useFocusRestoration } from '../../hooks/use-focus-restoration.ts'
import { useSearchFromAddress } from '../../hooks/use-library-search.ts'
import { useUploadPendingSaves } from '../../hooks/use-upload-pending-saves.ts'
import { useWarnBeforeLeavingUpload } from '../../hooks/use-uploads.ts'
import { useViewport } from '../../hooks/use-viewport.ts'
import { Notice } from '../notice.tsx'
import { PendingMask } from '../pending-mask.tsx'
import { FocusIndicator } from './focus-indicator.tsx'
import { LayoutHeader } from './layout-header/layout-header.tsx'
import { LayoutMain } from './layout-main.tsx'
import { LayoutMenu } from './layout-menu/layout-menu.tsx'
import '../../utils/nostalgist.ts'
import { PhoneNavBar } from './phone-nav-bar.tsx'
import { PhoneSearchScreen } from './phone-search/phone-search-screen.tsx'
import { useSearchShortcut } from './search-field.tsx'
import { SidebarContainer } from './sidebar-container.tsx'
import { SidebarConsolesHeading } from './sidebar-links/sidebar-consoles-heading.tsx'
import { SidebarLinks } from './sidebar-links/sidebar-links.tsx'
import { StatusBar } from './status-bar.tsx'

function getPostfixedTitle(title: string) {
  return title ? `${title} - ${metadata.title}` : metadata.title
}

export default function LibraryLayout({ children }: Readonly<PropsWithChildren>) {
  const title = usePageTitle()
  useUploadPendingSaves()
  useWarnBeforeLeavingUpload()
  const { isLargeScreen } = useViewport()

  useFocusRestoration()
  useCrossOriginIsolatedNavigation()
  useSearchFromAddress()
  useSearchShortcut()

  return (
    <>
      <title>{getPostfixedTitle(title)}</title>

      <div className={clsx('library-layout flex min-h-screen flex-col bg-(--color-background)')}>
        <LayoutHeader />

        <SidebarContainer>
          {/* The menu sits beside the logo, large and one press up from search */}
          <div className='flex items-center justify-between pr-1 pb-4 pl-4' data-sn-section=''>
            <Link
              className='-m-1 flex items-center gap-2 rounded p-1 font-bold transition-opacity hover:opacity-80'
              data-sn-skip=''
              to={routes.libraryHome}
            >
              <Logo height='32' width='32' />
              <span className='font-serif font-semibold'>{metadata.title}</span>
            </Link>
            {isLargeScreen ? <LayoutMenu large /> : null}
          </div>
          <SidebarLinks part='pinned' />
          <SidebarConsolesHeading />
          <ScrollArea className='flex-1' size='2'>
            <SidebarLinks part='rest' />
          </ScrollArea>
        </SidebarContainer>

        <LayoutMain>{children}</LayoutMain>

        <div className='top-0 right-0 left-72 z-11 hidden h-4 bg-(--accent-9) lg:fixed lg:block' />
        <div className='inset-y-0 right-0 z-11 hidden h-full w-4 bg-(--accent-9) lg:fixed lg:block' />
        <StatusBar />
        <PhoneNavBar />
      </div>

      <FocusIndicator />
      <PhoneSearchScreen />

      <PendingMask />
      <Notice />
    </>
  )
}
