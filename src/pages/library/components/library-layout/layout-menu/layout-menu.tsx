import { Button, DropdownMenu } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsDialogOpen, useSpatialNavigationPaused } from '../../../atoms.ts'
import { AboutDialog } from './about-dialog.tsx'
import { DeviceStorageDialog } from './device-storage-dialog.tsx'
import { LogoutDialog } from './logout-dialog.tsx'
import { SettingsDialog } from './settings-dialog/settings-dialog.tsx'
import { ThemeMenuItem } from './theme-menu-item.tsx'

/** Settings, theme, device storage, about and log out. `inBar` is the phone's red bar, where it's a large icon like search beside it */
export function LayoutMenu({ inBar = false }: Readonly<{ inBar?: boolean }>) {
  const { t } = useTranslation()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()

  const [settingsDialogOpen, setSettingsDialogOpen] = useSettingsDialogOpen()
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [storageDialogOpen, setStorageDialogOpen] = useState(false)

  function handleClickSettings() {
    setSettingsDialogOpen(true)
    setSpatialNavigationPaused(true)
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {inBar ? (
            <button
              aria-label={t('common.menu')}
              className='grid size-10 place-items-center text-white'
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

      <SettingsDialog onOpenChange={setSettingsDialogOpen} open={settingsDialogOpen} />
      <LogoutDialog onOpenChange={setLogoutDialogOpen} open={logoutDialogOpen} />
      <AboutDialog onOpenChange={setAboutDialogOpen} open={aboutDialogOpen} />
      <DeviceStorageDialog onOpenChange={setStorageDialogOpen} open={storageDialogOpen} />
    </>
  )
}
