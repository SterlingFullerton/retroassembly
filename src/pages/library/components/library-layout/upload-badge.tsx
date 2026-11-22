import { Button, Popover } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { useUploads } from '../../hooks/use-uploads.ts'

/**
 * How far a ROM upload has got, shown in the layout while it runs, whichever library page is open. One that finished
 * with ROMs that weren't uploaded stays, saying how many: pressing it lists them, and Done there puts it away
 */
export function UploadBadge({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation()
  const { reset, upload } = useUploads()
  const total = upload.progress?.totalCount ?? upload.files.length

  if (upload.status === 'done' && upload.failures.length > 0) {
    return (
      <Popover.Root>
        <Popover.Trigger>
          <button className={clsx(className, 'cursor-pointer')} type='button'>
            <span className='icon-[mdi--alert-circle-outline]' />
            {t('upload.failedCount', { failed: upload.failures.length, total: upload.files.length })}
          </button>
        </Popover.Trigger>
        <Popover.Content maxWidth='calc(100vw - 32px)' size='2' width='420px'>
          <div className='text-sm'>
            <p className='text-(--gray-11)'>{t('upload.failedRoms')}</p>
            <ul className='mt-2 max-h-48 overflow-y-auto rounded-lg bg-(--gray-3) px-3 py-2'>
              {upload.failures.map(({ file, message }) => (
                <li className='py-0.5 break-all' key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span className='font-medium'>{file.name}</span>
                  <span className='text-(--red-11)'> — {message}</span>
                </li>
              ))}
            </ul>
            <div className='mt-3 flex justify-end'>
              <Popover.Close>
                <Button onClick={reset} variant='soft'>
                  <span className='icon-[mdi--check]' />
                  {t('common.done')}
                </Button>
              </Popover.Close>
            </div>
          </div>
        </Popover.Content>
      </Popover.Root>
    )
  }

  if (upload.status !== 'loading') {
    return
  }
  const done = upload.progress?.doneCount ?? 0
  return (
    <output className={className}>
      <span className='icon-[svg-spinners--180-ring]' />
      {t('upload.uploadingRoms')} {done} / {total}
    </output>
  )
}
