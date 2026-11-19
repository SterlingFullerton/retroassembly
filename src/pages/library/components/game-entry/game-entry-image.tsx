import { Skeleton } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { skeletonClassnames } from '../../constants/skeleton-classnames.ts'
import { useRomCover } from '../../hooks/use-rom-cover.ts'
import { useViewport } from '../../hooks/use-viewport.ts'
import { TiltCover } from '../tilt-cover.tsx'

/**
 * A game's cover. In a list (`framed`) it sits centred in a light rounded square, as large as fits, so tall and wide
 * covers take the same space and each row lines up; the console's stand-in, for a game without box art, is smaller and
 * faded. Elsewhere, like Home's banner, it fills its square, bottom-aligned or centred
 */
export function GameEntryImage({
  centered = false,
  framed = false,
  rom,
}: Readonly<{ centered?: boolean; framed?: boolean; rom: any }>) {
  const { t } = useTranslation()
  const goodcodes = getRomGoodcodes(rom)
  const { data: cover, isLoading } = useRomCover(rom)
  const [loaded, setLoaded] = useState(false)
  const shouldShowskeleton = isLoading || !loaded
  const { isLargeScreen } = useViewport()

  function handleLoad() {
    setLoaded(true)
  }

  const standIn = cover?.type === 'platform'

  if (framed) {
    const framedImage = (
      <img
        alt={goodcodes.rom}
        className={clsx(
          'max-h-full max-w-full object-contain',
          standIn ? 'max-h-[62%]! max-w-[62%]! opacity-55 grayscale-30' : 'rounded shadow-sm',
        )}
        loading='lazy'
        onError={handleLoad}
        onLoad={handleLoad}
        src={cover?.src}
      />
    )
    return (
      <div className='relative aspect-square w-full rounded-lg bg-(--gray-a3) transition-[translate,filter] duration-150 group-hover:-translate-y-1 group-hover:brightness-105'>
        {shouldShowskeleton ? (
          <div className='absolute inset-2 flex items-center justify-center'>
            <Skeleton
              className={skeletonClassnames[rom.platform] || 'aspect-square! size-full!'}
              loading
              style={{ animationDelay: `-${(rom.fileName.length % 10) / 4}s !important` }}
            />
          </div>
        ) : null}
        {cover?.src ? (
          <div
            className={clsx('absolute inset-2 flex items-center justify-center transition-opacity', {
              'opacity-0': !loaded,
            })}
          >
            {isLargeScreen && !standIn ? (
              <TiltCover className='size-full' innerClassName='flex! size-full items-center justify-center'>
                {framedImage}
              </TiltCover>
            ) : (
              framedImage
            )}
          </div>
        ) : null}
      </div>
    )
  }

  const image = (
    <img
      alt={goodcodes.rom}
      className={clsx('max-h-full max-w-full rounded-lg object-contain', centered ? 'object-center' : 'object-bottom')}
      loading='lazy'
      onError={handleLoad}
      onLoad={handleLoad}
      src={cover?.src}
    />
  )

  const atropos = (
    <TiltCover
      className='size-full'
      innerClassName={clsx('flex! justify-center transition-opacity', centered ? 'items-center' : 'items-end', {
        'opacity-0': !loaded,
      })}
    >
      {image}
    </TiltCover>
  )

  const coverElement = isLargeScreen ? (
    atropos
  ) : (
    <div className='flex size-full items-center justify-center'>{image}</div>
  )

  return (
    <div className='relative aspect-square w-9/10! overflow-hidden transition-[translate,filter] duration-150 group-hover:-translate-y-1 group-hover:brightness-105'>
      <AnimatePresence>
        {shouldShowskeleton ? (
          <motion.div
            animate={{ opacity: 1 }}
            className={clsx('absolute top-0 flex size-full justify-center', centered ? 'items-center' : 'items-end')}
            exit={{ opacity: 0 }}
          >
            <Skeleton
              className={skeletonClassnames[rom.platform] || 'aspect-square! size-full!'}
              loading
              style={{
                animationDelay: `-${(rom.fileName.length % 10) / 4}s !important`,
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {cover?.src ? coverElement : null}
      {/* A game on several discs is one entry; the badge says how many */}
      {rom.discCount > 1 ? (
        <span className='absolute right-1 bottom-1 z-1 rounded-full bg-(--accent-9) px-2 py-0.5 text-[11px] font-bold text-white'>
          {t('emulator.discCount', { count: rom.discCount })}
        </span>
      ) : null}
    </div>
  )
}
