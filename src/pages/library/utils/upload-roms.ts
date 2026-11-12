import type { PlatformName } from '#@/constants/platform.ts'
import { getROMMd5 } from './file.ts'

interface UploadRomOptions {
  file: File
  md5?: string
  /** Called as the file's bytes are sent, with how many of them have been sent so far */
  onProgress?: (sentBytes: number) => void
  platform: PlatformName
}

function getErrorMessage(xhr: XMLHttpRequest) {
  try {
    const json = JSON.parse(xhr.responseText)
    if (typeof json?.message === 'string') {
      return json.message
    }
  } catch {}
  if (xhr.status === 413) {
    return 'The file is larger than the server accepts'
  }
  // An error page from a proxy in front of the app says nothing useful as text
  const text = xhr.responseText.trim()
  if (text && !text.startsWith('<') && text.length < 300) {
    return text
  }
  return `${xhr.status} ${xhr.statusText}`.trim() || 'Upload failed'
}

/**
 * Uploads a ROM to the library. This is XMLHttpRequest rather than fetch, since fetch can't tell how much of a request's
 * body has been sent, and a big ROM would otherwise show no progress until it has all gone.
 */
function uploadRom({ file, md5, onProgress, platform }: UploadRomOptions) {
  const form = new FormData()
  form.append('file', file)
  if (md5) {
    form.append('md5', md5)
  }
  form.append('platform', platform)

  return new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/roms')
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        // The request body is the file plus a little form data around it; count only the file
        onProgress?.(Math.min(file.size, (event.loaded / event.total) * file.size))
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size)
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          resolve(xhr.responseText)
        }
      } else {
        reject(new Error(getErrorMessage(xhr)))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
    xhr.send(form)
  })
}

// How many ROMs are sent at once. While the server files away one ROM, the others keep the connection busy
const concurrency = 3
// Speed is measured over the last few seconds, so it follows changes without jumping about
const speedWindow = 5000
const progressInterval = 250

export interface ActiveUpload {
  file: File
  sentBytes: number
  /** preparing: reading the ROM to identify it. sending: its bytes are going up. processing: the server has them all */
  stage: 'preparing' | 'processing' | 'sending'
}

export interface UploadFailure {
  file: File
  message: string
}

export interface UploadSnapshot {
  active: ActiveUpload[]
  /** Bytes of the ROMs sent so far, counting finished ones, failed ones included, in full */
  doneBytes: number
  doneCount: number
  failedCount: number
  /** Bytes a second, once there's been time to measure */
  speed?: number
  totalBytes: number
  totalCount: number
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Uploads ROMs a few at a time, reporting how far along they are a few times a second */
export async function uploadRoms({
  files,
  onProgress,
  platform,
}: {
  files: File[]
  onProgress: (snapshot: UploadSnapshot) => void
  platform: PlatformName
}) {
  const queue = [...files]
  const active = new Map<File, ActiveUpload>()
  const succeeded: File[] = []
  const failed: UploadFailure[] = []
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  let finishedBytes = 0
  // Every byte that has gone up, for the speed. A failed ROM's unsent bytes count toward the bar but not toward this
  let sentBytes = 0
  const samples: { bytes: number; time: number }[] = []

  function report() {
    const now = performance.now()
    samples.push({ bytes: sentBytes, time: now })
    while (samples.length > 2 && now - samples[1].time > speedWindow) {
      samples.shift()
    }
    const [first] = samples
    const elapsed = now - first.time
    const activeList = [...active.values()]
    onProgress({
      active: activeList,
      doneBytes: finishedBytes + activeList.reduce((sum, upload) => sum + upload.sentBytes, 0),
      doneCount: succeeded.length + failed.length,
      failedCount: failed.length,
      speed: elapsed >= 1000 ? ((sentBytes - first.bytes) / elapsed) * 1000 : undefined,
      totalBytes,
      totalCount: files.length,
    })
  }

  async function uploadNext(file: File) {
    const upload: ActiveUpload = { file, sentBytes: 0, stage: 'preparing' }
    active.set(file, upload)
    try {
      const md5 = await getROMMd5(file, platform)
      upload.stage = 'sending'
      await uploadRom({
        file,
        md5,
        onProgress(bytes) {
          sentBytes += Math.max(0, bytes - upload.sentBytes)
          upload.sentBytes = bytes
          if (bytes >= file.size) {
            upload.stage = 'processing'
          }
        },
        platform,
      })
      succeeded.push(file)
    } catch (error) {
      failed.push({ file, message: getErrorText(error) })
    } finally {
      active.delete(file)
      finishedBytes += file.size
    }
  }

  async function work() {
    for (let file = queue.shift(); file; file = queue.shift()) {
      await uploadNext(file)
    }
  }

  report()
  const timer = setInterval(report, progressInterval)
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => work()))
  } finally {
    clearInterval(timer)
  }
  report()
  return { failed, succeeded }
}
