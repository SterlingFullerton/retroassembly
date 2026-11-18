import { Skeleton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { TiltCover } from '#@/pages/library/components/tilt-cover.tsx'
import { skeletonClassnames } from '#@/pages/library/constants/skeleton-classnames.ts'
import { useRomCover } from '../../../hooks/use-rom-cover.ts'

export function GameCover({ className = '', parallax = false, rom }) {
  const { data: cover, isLoading } = useRomCover(rom)

  let content: ReactNode
  if (isLoading) {
    content = <Skeleton className={skeletonClassnames[rom.platform] || 'aspect-square! size-full!'} loading />
  } else if (cover) {
    const img = <img alt={rom.name} className='block h-auto w-full' loading='lazy' src={cover.src} />
    content = parallax ? <TiltCover className='size-full!'>{img}</TiltCover> : img
  }

  return (
    <a
      className={clsx('transition-[filter] hover:brightness-110', className)}
      href={cover?.src}
      rel='noreferrer noopener'
      target='_blank'
      title={rom.name}
    >
      {content}
    </a>
  )
}
