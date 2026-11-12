import { Button, Dialog } from '@radix-ui/themes'
import { fileOpen } from 'browser-fs-access'
import confetti from 'canvas-confetti'
import { clsx } from 'clsx'
import { isPlainObject } from 'es-toolkit'
import { isMatch } from 'es-toolkit/compat'
import { DateTime } from 'luxon'
import { useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { mutate } from 'swr'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'
import { useRouter } from '../../hooks/use-router.ts'
import { type UploadFailure, type UploadSnapshot, uploadRoms } from '../../utils/upload-roms.ts'
import { UploadInstruction } from './upload-instruction.tsx'
import { UploadProgress } from './upload-progress.tsx'

export function UploadDialog({ platform, toggleOpen }: Readonly<{ platform: PlatformName; toggleOpen: () => void }>) {
  const { t } = useTranslation()
  const { currentUser, env, isOfficialHost } = useGlobalLoaderData()
  const maxFiles = Math.trunc(Number(env.RETROASSEMBLY_RUN_TIME_MAX_UPLOAD_AT_ONCE)) || 1000
  const cutoffDate = DateTime.fromISO('2026-01-01')
  let maxRomCount = Math.trunc(Number(env.RETROASSEMBLY_RUN_TIME_MAX_ROM_COUNT)) || Infinity
  if (currentUser && 'created_at' in currentUser && typeof currentUser.created_at === 'string') {
    const createdAt = DateTime.fromISO(currentUser.created_at)
    if (createdAt.isValid && createdAt >= cutoffDate) {
      maxRomCount = Math.trunc(Number(env.RETROASSEMBLY_RUN_TIME_MAX_ROM_COUNT_2026)) || maxRomCount
    }
  }

  const { reload } = useRouter()
  const { getRootProps, isDragActive } = useDropzone({ onDrop })

  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<'done' | 'initial' | 'loading'>('initial')
  const [successCount, setSuccessCount] = useState(0)
  const [failures, setFailures] = useState<UploadFailure[]>([])
  const [progress, setProgress] = useState<UploadSnapshot>()

  // Leaving or reloading the page stops the upload, so the browser asks first
  useEffect(() => {
    if (status !== 'loading') {
      return
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload)
  }, [status])

  async function refreshLibrary() {
    await reload()
    await mutate((key) => isPlainObject(key) && isMatch(key, { endpoint: 'roms/search' }), false)
  }

  async function upload(files: File[]) {
    setFiles(files)
    setStatus('loading')
    setFailures([])
    setProgress(undefined)
    const result = await uploadRoms({ files, onProgress: setProgress, platform })
    setSuccessCount(result.succeeded.length)
    setFailures(result.failed)

    if (result.failed.length === 0) {
      toggleOpen()
      await refreshLibrary()
    } else {
      setStatus('done')
    }
    if (result.succeeded.length > 0) {
      await confetti({ disableForReducedMotion: true, particleCount: 150, spread: 180 })
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

  function prevendDefaultWhenUploading(event: Event) {
    if (status === 'loading') {
      event.preventDefault()
    }
  }

  async function handleClickDone() {
    toggleOpen()
    await refreshLibrary()
  }

  return (
    <Dialog.Content
      aria-describedby={undefined}
      onEscapeKeyDown={prevendDefaultWhenUploading}
      onPointerDownOutside={prevendDefaultWhenUploading}
    >
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
                  <span className='text-sm text-(--accent-9)'>{t('upload.dropFilesHere')}</span>
                ) : (
                  <>
                    <span className='text-sm text-(--accent-9)'>{t('upload.dragFilesHereOr')}</span>
                    <Button onClick={handleClickSelect} size='2'>
                      <span className='icon-[mdi--folder-open]' />
                      {t('upload.selectFiles')}
                    </Button>
                  </>
                )}
              </div>

              {isOfficialHost ? (
                <div className='mt-4 flex flex-col gap-1 text-xs text-(--accent-9)'>
                  <p>{t('upload.legalDisclaimer')}</p>
                  <p>
                    {t('home.dumpingRomsLinks')}{' '}
                    <a className='underline' href='https://dumping.guide/' rel='noreferrer noopener' target='_blank'>
                      dumping.guide
                    </a>
                    ,{' '}
                    <a
                      className='underline'
                      href='https://emulation.gametechwiki.com/index.php/Ripping_games'
                      rel='noreferrer noopener'
                      target='_blank'
                    >
                      Ripping games - Emulation General Wiki
                    </a>
                    .
                  </p>
                </div>
              ) : null}

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
