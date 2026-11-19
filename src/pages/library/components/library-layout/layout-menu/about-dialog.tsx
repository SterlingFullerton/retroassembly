import { Button, Dialog, VisuallyHidden } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { metadata } from '#@/constants/metadata.ts'
import { Logo } from '#@/pages/components/logo.tsx'
import { DialogRoot } from '../../dialog-root.tsx'

export function AboutDialog({ onOpenChange, ...props }: Readonly<Dialog.RootProps>) {
  const { t } = useTranslation()

  function handleOpenChange(open: boolean) {
    onOpenChange?.(open)
  }

  return (
    <DialogRoot {...props} onOpenChange={handleOpenChange}>
      <Dialog.Content aria-describedby={undefined} width='340px'>
        <VisuallyHidden>
          <Dialog.Title className='flex items-center gap-2'>{t('common.about')}</Dialog.Title>
        </VisuallyHidden>
        <div className='flex flex-col items-center gap-2 p-2 text-center'>
          <Logo height='56' width='56' />
          <div className='font-serif text-xl font-semibold text-(--accent-11)'>{metadata.title}</div>
          <div className='font-serif text-sm'>{t(metadata.descriptionI18nKey)}</div>
          <div className='flex flex-col gap-2 pt-2 pb-4 text-xs opacity-70'>
            {metadata.version ? (
              <div>
                {t('common.version')}:
                <span className='ml-0.5'>{metadata.version}</span>
              </div>
            ) : null}
            <div>
              {t('common.date')}: <span className='ml-0.5'>{metadata.buildDate}</span>
            </div>
          </div>
        </div>

        <div className='absolute top-6 right-6'>
          <Dialog.Close>
            <Button variant='ghost'>
              <span className='icon-[mdi--close] size-5' />
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </DialogRoot>
  )
}
