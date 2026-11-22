import { useAtom } from 'jotai'
import { useEffect } from 'react'
import { noticeAtom } from '#@/pages/atoms.ts'
import { RadixThemePortal } from '#@/pages/components/radix-theme-portal.tsx'

const shownFor = 5000

/**
 * The message about something that just failed (a favorite, a delete, an upload): a line at the bottom of the screen,
 * over any dialog and the pause menu, gone after a few seconds
 */
export function Notice() {
  const [notice, setNotice] = useAtom(noticeAtom)

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = setTimeout(() => setNotice(undefined), shownFor)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  if (!notice) {
    return
  }

  return (
    <RadixThemePortal>
      <div className='pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center'>
        <p
          className='flex max-w-md items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-white/15'
          key={notice.id}
          role='alert'
        >
          <span className='icon-[mdi--alert-circle-outline] size-5 shrink-0 text-red-400' />
          {notice.message}
        </p>
      </div>
    </RadixThemePortal>
  )
}
