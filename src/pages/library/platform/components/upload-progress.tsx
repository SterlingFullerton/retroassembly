import { Progress } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import type { UploadSnapshot } from '../../utils/upload-roms.ts'

const byteUnits = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

function formatBytes(bytes: number, language: string) {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < byteUnits.length - 1) {
    value /= 1000
    unit += 1
  }
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
    style: 'unit',
    unit: byteUnits[unit],
  }).format(value)
}

function formatDuration(seconds: number, language: string) {
  function format(value: number, unit: 'hour' | 'minute' | 'second') {
    return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
  }
  if (seconds < 60) {
    return format(Math.max(1, Math.round(seconds / 5) * 5), 'second')
  }
  if (seconds < 3600) {
    return format(Math.round(seconds / 60), 'minute')
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes ? `${format(hours, 'hour')} ${format(minutes, 'minute')}` : format(hours, 'hour')
}

/** How an upload is going: a bar for the bytes sent, how many ROMs are done, the speed, and the ROMs on their way */
export function UploadProgress({ progress, total }: Readonly<{ progress?: UploadSnapshot; total: number }>) {
  const { i18n, t } = useTranslation()
  const { language } = i18n

  const percent = progress?.totalBytes ? (progress.doneBytes / progress.totalBytes) * 100 : 0
  const remainingBytes = progress ? progress.totalBytes - progress.doneBytes : 0
  const secondsLeft = progress?.speed ? remainingBytes / progress.speed : undefined

  return (
    <div className='my-4'>
      <Progress className='[&>.rt-ProgressIndicator]:duration-300!' max={100} size='3' value={percent} />

      <div className='mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm'>
        <span className='font-medium'>
          {t('upload.filesProgress', { done: progress?.doneCount ?? 0, total })}
          {progress ? (
            <span className='font-normal text-(--gray-11)'>
              {' · '}
              {t('upload.bytesProgress', {
                sent: formatBytes(progress.doneBytes, language),
                total: formatBytes(progress.totalBytes, language),
              })}
            </span>
          ) : null}
        </span>
        {progress?.speed ? (
          <span className='text-(--gray-11) tabular-nums'>
            {t('upload.speed', { speed: formatBytes(progress.speed, language) })}
            {secondsLeft === undefined
              ? null
              : ` · ${t('upload.timeLeft', { time: formatDuration(secondsLeft, language) })}`}
          </span>
        ) : null}
      </div>

      {progress?.active.length ? (
        <ul className='mt-3 flex flex-col gap-1.5 rounded-md bg-(--gray-3) px-3 py-2 text-xs'>
          {progress.active.map(({ file, sentBytes, stage }) => (
            <li className='flex items-center gap-2' key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span className='icon-[svg-spinners--180-ring] shrink-0 text-(--gray-10)' />
              <span className='min-w-0 flex-1 truncate' title={file.name}>
                {file.name}
              </span>
              <span className='shrink-0 text-(--gray-11) tabular-nums'>
                {
                  {
                    preparing: t('upload.preparing'),
                    processing: t('upload.processing'),
                    sending: `${formatBytes(sentBytes, language)} / ${formatBytes(file.size, language)}`,
                  }[stage]
                }
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className='mt-3 flex flex-wrap items-center gap-2 text-sm text-(--gray-11)'>
        {progress?.failedCount ? (
          <span className='text-(--red-11)'>
            {progress.failedCount} {t('common.failed')}.
          </span>
        ) : null}
        <span>{t('common.doNotTurnOffDevice')}</span>
      </div>
    </div>
  )
}
