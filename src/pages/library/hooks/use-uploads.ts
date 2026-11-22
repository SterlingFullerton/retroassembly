import confetti from 'canvas-confetti'
import { atom, useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import type { PlatformName } from '#@/constants/platform.ts'
import { type UploadFailure, type UploadSnapshot, uploadRoms } from '../utils/upload-roms.ts'
import { useLibraryRefresh } from './use-library-refresh.ts'

/** The library's ROM upload, kept by the layout so it carries on, and shows its progress, on any library page */
export interface UploadState {
  failures: UploadFailure[]
  files: File[]
  platform?: PlatformName
  progress?: UploadSnapshot
  status: 'done' | 'initial' | 'loading'
  successCount: number
}

const initialUpload: UploadState = { failures: [], files: [], status: 'initial', successCount: 0 }
const uploadAtom = atom<UploadState>(initialUpload)

export function useUploads() {
  const store = useStore()
  const upload = useAtomValue(uploadAtom)
  const refresh = useLibraryRefresh()

  /** Uploads `files` for `platform`, then brings the library up to date. Returns the upload's outcome */
  async function start(platform: PlatformName, files: File[]) {
    store.set(uploadAtom, { ...initialUpload, files, platform, status: 'loading' })
    const result = await uploadRoms({
      files,
      onProgress: (progress) => store.set(uploadAtom, (current) => ({ ...current, progress })),
      platform,
    })
    store.set(uploadAtom, (current) => ({
      ...current,
      failures: result.failed,
      status: 'done',
      successCount: result.succeeded.length,
    }))
    await refresh()
    // Only for an upload that all went through: one with failures says so instead (see the upload badge)
    if (result.succeeded.length > 0 && result.failed.length === 0) {
      await confetti({ disableForReducedMotion: true, particleCount: 150, spread: 180 })
    }
    return result
  }

  /** Clears a finished upload, so the next one starts afresh */
  function reset() {
    if (store.get(uploadAtom).status !== 'loading') {
      store.set(uploadAtom, initialUpload)
    }
  }

  return { reset, start, upload }
}

/** While an upload is going, leaving or reloading the page would stop it, so the browser asks first */
export function useWarnBeforeLeavingUpload() {
  const { status } = useAtomValue(uploadAtom)
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
}
