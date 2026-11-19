import { Skeleton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { noop } from 'es-toolkit'
import { type MouseEvent, type ReactNode, useState } from 'react'
import { TiltCover } from '#@/pages/library/components/tilt-cover.tsx'
import { skeletonClassnames } from '#@/pages/library/constants/skeleton-classnames.ts'
import { useRomCover } from '../../../hooks/use-rom-cover.ts'
import { GameMediaCarousel } from './game-media/game-media-carousel.tsx'

/** The game's box art; tapped, it opens full size in the app's picture viewer */
export function GameCover({ className = '', imgClassName = 'block h-auto w-full', parallax = false, rom }) {
  const { data: cover, isLoading } = useRomCover(rom)
  const [open, setOpen] = useState(false)
  const [originRect, setOriginRect] = useState<DOMRect | null>(null)

  let content: ReactNode
  if (isLoading) {
    content = <Skeleton className={skeletonClassnames[rom.platform] || 'aspect-square! size-full!'} loading />
  } else if (cover) {
    const img = <img alt={rom.name} className={imgClassName} loading='lazy' src={cover.src} />
    content = parallax ? <TiltCover className='size-full!'>{img}</TiltCover> : img
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (cover?.src) {
      setOriginRect(event.currentTarget.getBoundingClientRect())
      setOpen(true)
    }
  }

  return (
    <>
      <button
        className={clsx('cursor-pointer text-left transition-[filter] hover:brightness-110', className)}
        onClick={handleClick}
        title={rom.name}
        type='button'
      >
        {content}
      </button>
      {cover?.src ? (
        <GameMediaCarousel
          initialIndex={0}
          items={[{ src: cover.src, type: 'image' }]}
          onClose={() => setOpen(false)}
          onSlideChange={noop}
          open={open}
          originRect={originRect}
        />
      ) : null}
    </>
  )
}
