import { Skeleton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { noop } from 'es-toolkit'
import { type MouseEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TiltCover } from '#@/pages/library/components/tilt-cover.tsx'
import { skeletonClassnames } from '#@/pages/library/constants/skeleton-classnames.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { useRomCover } from '../../../hooks/use-rom-cover.ts'
import { GameMediaCarousel } from './game-media/game-media-carousel.tsx'

/**
 * The game's box art; tapped, it opens full size in the app's picture viewer. Not where the viewer would sit on top of
 * another window (`viewable` off), nor for the console's stand-in when the game has none: that's a plain picture, small
 * (`placeholderClassName`)
 */
export function GameCover({
  className = '',
  imgClassName = 'block h-auto w-full',
  parallax = false,
  placeholderClassName = 'block h-auto w-24',
  rom,
  viewable = true,
}) {
  const { t } = useTranslation()
  const { data: cover, isLoading } = useRomCover(rom)
  const [open, setOpen] = useState(false)
  const [originRect, setOriginRect] = useState<DOMRect | null>(null)
  const name = getRomGoodcodes(rom).rom
  const placeholder = cover?.type === 'platform'

  let content: ReactNode
  if (isLoading) {
    content = <Skeleton className={skeletonClassnames[rom.platform] || 'aspect-square! size-full!'} loading />
  } else if (cover) {
    const img = (
      <img alt={name} className={placeholder ? placeholderClassName : imgClassName} loading='lazy' src={cover.src} />
    )
    content = parallax && !placeholder ? <TiltCover className='size-full!'>{img}</TiltCover> : img
  }

  if (!viewable || placeholder || !cover?.src) {
    return <div className={className}>{content}</div>
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    setOriginRect(event.currentTarget.getBoundingClientRect())
    setOpen(true)
  }

  return (
    <>
      <button
        aria-label={`${name}, ${t('game.viewBoxArt')}`}
        className={clsx('cursor-pointer text-left transition-[filter] hover:brightness-110', className)}
        onClick={handleClick}
        title={t('game.viewBoxArt')}
        type='button'
      >
        {content}
      </button>
      <GameMediaCarousel
        ariaLabel={name}
        initialIndex={0}
        items={[{ src: cover.src, type: 'image' }]}
        onClose={() => setOpen(false)}
        onSlideChange={noop}
        open={open}
        originRect={originRect}
      />
    </>
  )
}
