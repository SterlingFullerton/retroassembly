import { Button, Dialog, ScrollArea } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogRoot } from '../../components/dialog-root.tsx'
import { PlatformSettings } from './platform-settings.tsx'

/** The button that opens the list of every console, to choose the ones the library shows */
export function ChooseConsoles() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} type='button' variant='soft'>
        <span className='icon-[mdi--checkbox-multiple-marked-outline]' />
        {t('settings.chooseConsoles')}
      </Button>

      <DialogRoot onOpenChange={setOpen} open={open}>
        {/* On a phone, upright or sideways, it fills the screen (see globals.css) */}
        <Dialog.Content
          aria-describedby={undefined}
          className='settings-dialog lg:w-5xl!'
          maxWidth='calc(100vw - var(--space-8))'
        >
          <Dialog.Title>{t('settings.chooseConsoles')}</Dialog.Title>

          <div className='settings-fill'>
            <div className='settings-scroll h-[60vh]'>
              <ScrollArea scrollbars='vertical' size='2'>
                <div className='p-1 pr-4'>
                  <PlatformSettings />
                </div>
              </ScrollArea>
            </div>
          </div>

          <div className='settings-close absolute top-6 right-6'>
            <Dialog.Close>
              <Button title={t('common.close')} variant='ghost'>
                <span className='icon-[mdi--close] size-5' />
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </DialogRoot>
    </>
  )
}
