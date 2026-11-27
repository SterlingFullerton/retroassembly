import { Button } from '@radix-ui/themes'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsTitle } from '../settings-title.tsx'

const DeviceStorageDialog = lazy(async () => {
  const { DeviceStorageDialog } =
    await import('#@/pages/library/components/library-layout/layout-menu/device-storage-dialog.tsx')
  return { default: DeviceStorageDialog }
})

/** The games kept on this device, in the same dialog as the menu's */
export function DeviceStorageSettings() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  if (open && !opened) {
    setOpened(true)
  }

  return (
    <div>
      <div className='flex w-full items-center justify-between gap-2'>
        <SettingsTitle className='mb-0'>{t('storage.title')}</SettingsTitle>
        <Button onClick={() => setOpen(true)} size='2' type='button' variant='soft'>
          {t('storage.manage')}
        </Button>
      </div>
      <div className='text-xs text-(--gray-11)'>{t('storage.note')}</div>
      {opened ? (
        <Suspense fallback={null}>
          <DeviceStorageDialog onOpenChange={setOpen} open={open} />
        </Suspense>
      ) : null}
    </div>
  )
}
