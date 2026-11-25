import { Button, DropdownMenu } from '@radix-ui/themes'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { getSettingsPath, useSettingsOrigin } from '../../../settings/sections.ts'
import { AboutDialog } from './about-dialog.tsx'
import { LogoutDialog } from './logout-dialog.tsx'
import { ThemeMenuItem } from './theme-menu-item.tsx'

// The large dialog isn't needed to browse the library, so its code is fetched when it's first opened
const DeviceStorageDialog = lazy(async () => {
  const { DeviceStorageDialog } = await import('./device-storage-dialog.tsx')
  return { default: DeviceStorageDialog }
})

/**
 * Settings, theme, device storage, about and log out. `large` is a large icon: in the phone's red bar, like search beside
 * it, and beside the logo in the sidebar
 */
export function LayoutMenu({ large = false }: Readonly<{ large?: boolean }>) {
  const { t } = useTranslation()
  const { currentUser } = useGlobalLoaderData()
  const username = currentUser && 'username' in currentUser ? currentUser.username : ''
  const navigate = useNavigate()
  const { linkState } = useSettingsOrigin()

  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [storageDialogOpen, setStorageDialogOpen] = useState(false)
  const [storageDialogOpened, setStorageDialogOpened] = useState(false)
  if (storageDialogOpen && !storageDialogOpened) {
    setStorageDialogOpened(true)
  }

  // The settings are a page, which goes back to where it was opened from
  async function handleClickSettings() {
    await navigate(getSettingsPath(), { state: linkState })
  }

  return (
    <>
      <DropdownMenu.Root>
        {/* Down moves on to what's under the button rather than opening the menu; Enter and Space open it */}
        <DropdownMenu.Trigger
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
            }
          }}
        >
          {large ? (
            <button
              aria-label={t('common.menu')}
              className='grid size-10 place-items-center rounded text-white transition-colors hover:bg-white/10'
              title={t('common.menu')}
              type='button'
            >
              <span className='icon-[mdi--menu] size-6' />
            </button>
          ) : (
            <Button
              aria-label={t('common.menu')}
              className='m-0! text-white! hover:bg-white/10!'
              type='button'
              variant='ghost'
            >
              <span className='icon-[mdi--menu]' />
            </Button>
          )}
        </DropdownMenu.Trigger>

        <DropdownMenu.Content variant='solid'>
          {/* Who's signed in */}
          {username ? (
            <>
              <DropdownMenu.Label>
                <span className='icon-[mdi--account] mr-2' />
                <span className='max-w-48 truncate'>{username}</span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator />
            </>
          ) : null}
          <DropdownMenu.Item onClick={handleClickSettings}>
            <span className='icon-[mdi--cog]' />
            {t('nav.settings')}
          </DropdownMenu.Item>

          <ThemeMenuItem />

          <DropdownMenu.Separator />

          <DropdownMenu.Item onClick={() => setStorageDialogOpen(true)}>
            <span className='icon-[mdi--harddisk]' />
            {t('storage.title')}
          </DropdownMenu.Item>

          <DropdownMenu.Item onClick={() => setAboutDialogOpen(true)}>
            <span className='icon-[mdi--information]' />
            {t('common.about')}
          </DropdownMenu.Item>

          <DropdownMenu.Separator />

          <DropdownMenu.Item color='red' onClick={() => setLogoutDialogOpen(true)}>
            <span className='icon-[mdi--logout]' />
            {t('auth.logout')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <LogoutDialog onOpenChange={setLogoutDialogOpen} open={logoutDialogOpen} />
      <AboutDialog onOpenChange={setAboutDialogOpen} open={aboutDialogOpen} />
      {/* Fetched when first opened, then kept, so closing still animates */}
      {storageDialogOpened ? (
        <Suspense fallback={null}>
          <DeviceStorageDialog onOpenChange={setStorageDialogOpen} open={storageDialogOpen} />
        </Suspense>
      ) : null}
    </>
  )
}
