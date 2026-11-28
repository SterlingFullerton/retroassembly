import { useEffect } from 'react'
import { useRevalidator } from 'react-router'
import { saveQueue } from '#@/emulator/save-queue.ts'
import { useGlobalLoaderData } from '#@/pages/hooks/use-global-loader-data.ts'

// Uploads saves the browser kept when the page was closed before they reached the server, then reloads the page data
// so Continue picks them up
export function useUploadPendingSaves() {
  const { revalidate } = useRevalidator()
  const userId = useGlobalLoaderData().currentUser?.id

  useEffect(() => {
    let cancelled = false
    // Saves are kept, and uploaded, only under the account signed in
    saveQueue.setUser(userId)
    ;(async () => {
      const uploaded = await saveQueue.flush()
      if (uploaded && !cancelled) {
        await revalidate()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [revalidate, userId])
}
