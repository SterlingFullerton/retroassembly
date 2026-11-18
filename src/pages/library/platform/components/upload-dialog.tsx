import { Button, Dialog } from '@radix-ui/themes'
import { fileOpen } from 'browser-fs-access'
import { clsx } from 'clsx'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { useUploads } from '../../hooks/use-uploads.ts'
import { UploadInstruction } from './upload-instruction.tsx'
import { UploadProgress } from './upload-progress.tsx'

export function UploadDialog({ platform, toggleOpen }: Readonly<{ platform: PlatformName; toggleOpen: () => void }>) {
  const { t } = useTranslation()
  const { env } = useGlobalLoaderData()
  const maxFiles = Math.trunc(Number(env.RETROASSEMBLY_RUN_TIME_MAX_UPLOAD_AT_ONCE)) || 1000
  const maxRomCount = Math.trunc(Number(env.RETROASSEMBLY_RUN_TIME_MAX_ROM_COUNT)) || Infinity

  const { getRootProps, isDragActive } = useDropzone({ onDrop })
  // The upload itself is kept by the library layout: it carries on, and shows its progress, if this dialog is closed
  const { reset, start, upload: current } = useUploads()
  const { failures, files, progress, successCount } = current
  const status = current.status === 'loading' || current.platform === platform ? current.status : 'initial'

  async function upload(files: File[]) {
    const result = await start(platform, files)
    if (result.failed.length === 0) {
      reset()
      toggleOpen()
    }
  }

  async function handleClickRetry() {
    await upload(failures.map(({ file }) => file))
  }

  function validateFiles(files: File[]) {
    let message = ''
    if (files.length > maxFiles) {
      message = t('upload.maxFilesLimit', { maxFiles })
    } else if (files.some((file) => !platformMap[platform].fileExtensions.some((ext) => file.name.endsWith(ext)))) {
      message = `${t('upload.supportedExtensions')}\n${platformMap[platform].fileExtensions.join(', ')}`
    }
    return message
  }

  async function handleClickSelect() {
    const files = await fileOpen({ extensions: platformMap[platform].fileExtensions, multiple: true })
    const message = validateFiles(files)
    if (message) {
      alert(message)
      return
    }
    await upload(files)
  }

  async function onDrop(files: File[]) {
    if (files.length > maxFiles) {
      alert(t('upload.maxFilesLimit', { maxFiles }))
      return
    }
    const message = validateFiles(files)
    if (message) {
      alert(message)
      return
    }
    await upload(files)
  }

  function handleClickDone() {
    reset()
    toggleOpen()
  }

  return (
    <Dialog.Content aria-describedby={undefined}>
      <Dialog.Title>
        {
          {
            done: t('upload.romsUploaded'),
            initial: t('game.selectRoms'),
            loading: t('upload.uploadingRoms'),
          }[status]
        }
      </Dialog.Title>

      {
        {
          initial: (
            <>
              <UploadInstruction maxFiles={maxFiles} maxRomCount={maxRomCount} platform={platform} />

              <div
                {...getRootProps()}
                className={clsx(
                  'mt-4 flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-(--accent-9) outline-none',
                  { 'bg-(--accent-3)': isDragActive },
                )}
              >
                {isDragActive ? (
                  <span className='text-sm text-(--accent-11)'>{t('upload.dropFilesHere')}</span>
                ) : (
                  <>
                    <span className='text-sm text-(--accent-11)'>{t('upload.dragFilesHereOr')}</span>
                    <Button onClick={handleClickSelect} size='2'>
                      <span className='icon-[mdi--folder-open]' />
                      {t('upload.selectFiles')}
                    </Button>
                  </>
                )}
              </div>

              <div className='mt-4 flex justify-end'>
                <Dialog.Close>
                  <Button variant='soft'>
                    <span className='icon-[mdi--close]' />
                    {t('common.cancel')}
                  </Button>
                </Dialog.Close>
              </div>
            </>
          ),

          loading: <UploadProgress progress={progress} total={files.length} />,

          done: (
            <div>
              <div className='py-10 text-center'>
                {t('upload.uploadSuccessMessage', { successCount, totalCount: files.length })}
              </div>

              {failures.length > 0 ? (
                <div className='text-sm'>
                  <p className='text-(--gray-11)'>{t('upload.failedRoms')}</p>
                  <ul className='mt-2 max-h-48 overflow-y-auto rounded-md bg-(--gray-3) px-3 py-2'>
                    {failures.map(({ file, message }) => (
                      <li className='py-0.5 break-all' key={`${file.name}-${file.size}-${file.lastModified}`}>
                        <span className='font-medium'>{file.name}</span>
                        <span className='text-(--red-11)'> — {message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className='mt-4 flex justify-end gap-2'>
                {failures.length > 0 ? (
                  <Button onClick={handleClickRetry} variant='soft'>
                    <span className='icon-[mdi--refresh]' />
                    {t('upload.retryFailed')}
                  </Button>
                ) : null}
                <Dialog.Close>
                  <Button onClick={handleClickDone} variant='soft'>
                    <span className='icon-[mdi--check]' />
                    {t('common.done')}
                  </Button>
                </Dialog.Close>
              </div>
            </div>
          ),
        }[status]
      }
    </Dialog.Content>
  )
}
