import { Button, Dialog, ScrollArea, Tabs } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsDialogTabName } from '#@/pages/library/atoms.ts'
import { DialogRoot } from '../../../dialog-root.tsx'
import { EmulatingSettings } from './emulating-settings/emulating-settings.tsx'
import { GeneralSettings } from './general-settings/general-settings.tsx'
import { InputsSettings } from './inputs-settings/inputs-setting.tsx'
import { LibrarySettings } from './library-settings/library-settings.tsx'

const settingsTabs = [
  { content: LibrarySettings, iconClass: 'icon-[mdi--bookshelf]', name: 'library' },
  { content: InputsSettings, iconClass: 'icon-[mdi--controller]', name: 'inputs' },
  { content: EmulatingSettings, iconClass: 'icon-[simple-icons--retroarch]', name: 'emulating' },
  { content: GeneralSettings, iconClass: 'icon-[mdi--cog]', name: 'general' },
]

// Whether the mouse or a finger, or the keyboard, was used last
let lastInput: 'keyboard' | 'pointer' = 'pointer'
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (lastInput = 'pointer'), { capture: true, passive: true })
  document.addEventListener('keydown', () => (lastInput = 'keyboard'), { capture: true, passive: true })
}

export function SettingsDialog({ onOpenChange, ...props }: Readonly<Dialog.RootProps>) {
  const { t } = useTranslation()
  const [tabName, setTabName] = useSettingsDialogTabName()
  // Opened with the mouse or a finger, the tabs show no focus ring until a key is pressed: the first tab may still be
  // given the focus, ready for the arrow keys, but showing it would look like a stray red box
  const [pointerOpened, setPointerOpened] = useState(false)
  const { content: TabContent } = settingsTabs.find((tab) => tab.name === tabName) || settingsTabs[0]

  function handleOpenChange(open: boolean) {
    onOpenChange?.(open)
  }

  function handleValueChange(tabName: string) {
    setTabName(tabName)
  }

  return (
    <DialogRoot {...props} onOpenChange={handleOpenChange}>
      <Dialog.Content
        aria-describedby={undefined}
        // On a phone, upright or sideways, it fills the screen like a page of its own (see globals.css)
        className={clsx('settings-dialog lg:w-5xl!', { 'no-tab-focus-ring': pointerOpened })}
        maxWidth='calc(100vw - var(--space-8))'
        onKeyDown={() => setPointerOpened(false)}
        onOpenAutoFocus={(event) => {
          // Opened with the mouse or a finger, nothing inside is focused, so no focus ring shows on the first tab; from
          // the keyboard or a controller, the first tab is focused as usual
          setPointerOpened(lastInput === 'pointer')
          if (lastInput === 'pointer') {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.focus()
            }
          }
        }}
      >
        <Dialog.Title className='flex items-center gap-2'>
          <span className='icon-[mdi--cog]' />
          {t('nav.settings')}
        </Dialog.Title>

        <div className='settings-fill'>
          <Tabs.Root asChild onValueChange={handleValueChange} value={tabName}>
            <div className='settings-fill'>
              <Tabs.List>
                {settingsTabs.map(({ iconClass, name }) => (
                  <Tabs.Trigger aria-label={t(`settings.${name}`)} key={name} value={name}>
                    <span
                      className={clsx('size-5', iconClass, {
                        'mr-2': name === tabName,
                        'mr-2 max-sm:mr-0': name !== tabName,
                      })}
                    />
                    {/* On a phone only the open tab is named, so all four fit across */}
                    <span
                      className={clsx('text-lg capitalize max-sm:text-base', { 'max-sm:hidden': name !== tabName })}
                    >
                      {t(`settings.${name}`)}
                    </span>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <div className='settings-scroll h-[60vh]'>
                <ScrollArea scrollbars='vertical' size='2'>
                  <div className='motion-preset-slide-up-sm p-4' key={tabName}>
                    <TabContent />
                  </div>
                </ScrollArea>
              </div>
            </div>
          </Tabs.Root>
        </div>

        <div className='settings-note mt-4 flex justify-between'>
          <div className='flex items-center gap-2 text-xs text-(--gray-11)'>
            <span className='icon-[mdi--content-save-check-outline] shrink-0' />
            {t('settings.immediateEffect')}
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
  )
}
