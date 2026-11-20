import { useTranslation } from 'react-i18next'
import { useUploads } from '../../hooks/use-uploads.ts'

/** How far a ROM upload has got, shown in the layout while it runs, whichever library page is open */
export function UploadBadge({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation()
  const { upload } = useUploads()
  if (upload.status !== 'loading') {
    return
  }
  const done = upload.progress?.doneCount ?? 0
  const total = upload.progress?.totalCount ?? upload.files.length
  return (
    <output className={className}>
      <span className='icon-[svg-spinners--180-ring]' />
      {t('upload.uploadingRoms')} {done} / {total}
    </output>
  )
}
