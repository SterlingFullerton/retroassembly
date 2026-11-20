import { metadata } from '#@/constants/metadata.ts'
import { Logo } from '../logo.tsx'
import { SkeletonGame } from './skeleton-game.tsx'
import { SkeletonHome } from './skeleton-home.tsx'
import { SkeletonList } from './skeleton-list.tsx'

// Every page is sent the same HTML, with all three skeletons in it, so which one shows is picked by the address as the
// page is read, before anything is drawn. The login page, the only one that isn't the library, shows none
const pickByAddress = `{
  const path = location.pathname.replace(/\\/+$/, '')
  document.documentElement.dataset.skeleton = path.startsWith('/login')
    ? 'none'
    : path === '' || path === '/library'
      ? 'home'
      : path.includes('/rom/')
        ? 'game'
        : 'list'
}`

const sidebarLinks = ['w-24', 'w-28', 'w-20', 'w-32', 'w-24', 'w-28', 'w-20', 'w-24']

/**
 * The library's frame, with grey shapes where the page's games will be, shown while a page's data loads the first time:
 * it's in the HTML the server sends, so it shows before the app's code has loaded, in place of a blank page
 */
export function LibrarySkeleton() {
  return (
    <div
      aria-busy='true'
      className='flex min-h-screen flex-col bg-(--color-background) [html[data-skeleton=none]_&]:hidden'
    >
      <script dangerouslySetInnerHTML={{ __html: pickByAddress }} />

      <div className='fixed inset-x-0 top-0 z-2 h-12 bg-(--accent-9) lg:hidden' />
      <div className='h-12 w-full shrink-0 bg-(--accent-9) lg:hidden' />

      <div className='z-1 hidden w-72 flex-col gap-2 bg-(--accent-9) px-4 pt-4 text-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex'>
        <div className='flex items-center gap-2 pb-4 font-bold'>
          <Logo height='32' width='32' />
          <span className='font-serif font-semibold'>{metadata.title}</span>
        </div>
        <div className='mb-2 h-8 rounded-md bg-white/20' />
        {sidebarLinks.map((width, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- the placeholders never move
          <div className='flex h-8 items-center gap-3 px-2' key={index}>
            <div className='size-5 rounded bg-white/20' />
            <div className={`h-3 rounded-full bg-white/20 ${width}`} />
          </div>
        ))}
      </div>

      <div className='top-0 right-0 left-72 z-11 hidden h-4 bg-(--accent-9) lg:fixed lg:block' />
      <div className='inset-y-0 right-0 z-11 hidden h-full w-4 bg-(--accent-9) lg:fixed lg:block' />
      <div className='fixed right-0 bottom-0 left-72 z-11 hidden h-12 bg-(--accent-9) lg:block' />
      <div className='pb-safe fixed inset-x-0 bottom-0 z-2 h-14 bg-(--accent-9) lg:hidden' />

      <div className='mb-[calc(3.5rem+env(safe-area-inset-bottom))] flex-1 border-r-[calc(0.5rem+env(safe-area-inset-right))] border-b-[0.5rem] border-l-[calc(0.5rem+env(safe-area-inset-left))] border-(--accent-9) lg:mt-4 lg:mr-4 lg:mb-0 lg:ml-72 lg:border-none lg:pb-12'>
        <div className='hidden [html[data-skeleton=home]_&]:block'>
          <SkeletonHome />
        </div>
        <div className='hidden [html[data-skeleton=game]_&]:block'>
          <SkeletonGame />
        </div>
        <div className='hidden [html[data-skeleton=list]_&]:block'>
          <SkeletonList />
        </div>
      </div>
    </div>
  )
}
