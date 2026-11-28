import useEmblaCarousel from 'embla-carousel-react'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RadixThemePortal } from '#@/pages/components/radix-theme-portal.tsx'
import { CarouselSlide } from './carousel-slide.tsx'

export interface MediaItem {
  type: 'cbz' | 'file' | 'image' | 'pdf' | 'video' | 'youtube'
  src: string
}

interface GameMediaCarouselProps {
  items: MediaItem[]
  initialIndex: number
  originRect: DOMRect | null
  open: boolean
  onClose: (currentIndex: number) => void
  onSlideChange: (index: number) => void
  /** What it shows, for screen readers */
  ariaLabel?: string
}

/** Tab and Shift+Tab go round the viewer's own buttons */
function keepTabInside(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') {
    return
  }
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button, iframe, video[controls]')]
  const first = buttons.at(0)
  const last = buttons.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

export function GameMediaCarousel({
  ariaLabel,
  items,
  initialIndex,
  originRect,
  open,
  onClose,
  onSlideChange,
}: Readonly<GameMediaCarouselProps>) {
  const { t } = useTranslation()
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: initialIndex })
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const currentIndexRef = useRef(currentIndex)
  const videoRefs = useMemo(() => new Map<number, HTMLVideoElement>(), [])
  const youtubeRefs = useMemo(() => new Map<number, HTMLIFrameElement>(), [])

  const onEmblaSelect = useCallback(() => {
    if (!emblaApi) {
      return
    }
    const idx = emblaApi.selectedScrollSnap()
    setCanScrollPrev(emblaApi.canScrollPrev())
    setCanScrollNext(emblaApi.canScrollNext())
    setCurrentIndex(idx)
    currentIndexRef.current = idx
    onSlideChange(idx)
    for (const [i, video] of videoRefs) {
      if (i !== idx) {
        video.pause()
      }
    }
    for (const [i, iframe] of youtubeRefs) {
      if (i !== idx) {
        iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*')
      }
    }
  }, [emblaApi, onSlideChange, videoRefs, youtubeRefs])

  useEffect(() => {
    if (!emblaApi) {
      return
    }
    let active = true
    queueMicrotask(() => {
      if (active) {
        onEmblaSelect()
      }
    })
    emblaApi.on('select', onEmblaSelect)
    emblaApi.on('reInit', onEmblaSelect)
    return () => {
      active = false
      emblaApi.off('select', onEmblaSelect)
      emblaApi.off('reInit', onEmblaSelect)
    }
  }, [emblaApi, onEmblaSelect])

  const handleClose = useCallback(() => {
    onClose(currentIndexRef.current)
  }, [onClose])

  // Open, the viewer is a window of its own: its keys go to it before the page's (which would otherwise move the focus
  // behind it, or leave the page on Back), the focus moves into it, and goes back where it was when it closes
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) {
      return
    }
    const abortController = new AbortController()
    const focusedBefore = document.activeElement instanceof HTMLElement ? document.activeElement : undefined

    globalThis.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          handleClose()
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          event.stopImmediatePropagation()
          emblaApi?.scrollPrev()
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopImmediatePropagation()
          emblaApi?.scrollNext()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      { capture: true, signal: abortController.signal },
    )

    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }))

    return () => {
      abortController.abort()
      document.body.style.overflow = ''
      focusedBefore?.focus({ preventScroll: true })
    }
  }, [open, handleClose, emblaApi])

  const panelAnimProps = useMemo(() => {
    if (!originRect) {
      return {
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        initial: { opacity: 0, scale: 0.95 },
      }
    }
    const left = Math.round(originRect.left)
    const top = Math.round(originRect.top)
    const width = Math.round(originRect.width)
    const height = Math.round(originRect.height)
    return {
      animate: {
        height: Math.round(window.innerHeight * 0.9),
        left: Math.round(window.innerWidth * 0.05),
        top: Math.round(window.innerHeight * 0.05),
        width: Math.round(window.innerWidth * 0.9),
      },
      exit: { height, left, top, width },
      initial: { height, left, top, width },
    }
  }, [originRect])

  return (
    <RadixThemePortal>
      <AnimatePresence>
        {open ? (
          // The Back key closes it as it does a window; Tab stays in it
          <motion.div
            aria-label={ariaLabel}
            aria-modal='true'
            exit={{ opacity: 1 }}
            key='viewer'
            onKeyDown={keepTabInside}
            // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <dialog> would sit above the viewer's own animation
            role='dialog'
          >
            {/* Backdrop */}
            <motion.div
              animate={{ opacity: 1 }}
              aria-hidden
              className='fixed inset-0 z-50 cursor-default bg-black/80'
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              onClick={handleClose}
            />
            {/* Panel */}
            <motion.div
              animate={panelAnimProps.animate}
              className='fixed z-50'
              exit={panelAnimProps.exit}
              initial={panelAnimProps.initial}
              onClick={(e) => e.stopPropagation()}
            >
              <div className='flex h-full flex-col overflow-hidden' ref={emblaRef}>
                <div className='flex h-full'>
                  {items.map((item, index) => (
                    <div className='flex min-h-0 min-w-0 flex-[0_0_100%] items-center justify-center' key={index}>
                      <CarouselSlide index={index} item={item} videoRefs={videoRefs} youtubeRefs={youtubeRefs} />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
            {/* Prev button */}
            {canScrollPrev ? (
              <motion.button
                animate={{ opacity: 1 }}
                aria-label={t('game.media.previous')}
                className='fixed top-1/2 left-[calc(1vw+0.75rem)] z-50 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-2 text-white hover:bg-black/70'
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                onClick={() => emblaApi?.scrollPrev()}
                type='button'
              >
                <span className='icon-[mdi--chevron-left] block size-6' />
              </motion.button>
            ) : null}
            {/* Next button */}
            {canScrollNext ? (
              <motion.button
                animate={{ opacity: 1 }}
                aria-label={t('game.media.next')}
                className='fixed top-1/2 right-[calc(1vw+0.75rem)] z-50 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-2 text-white hover:bg-black/70'
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                onClick={() => emblaApi?.scrollNext()}
                type='button'
              >
                <span className='icon-[mdi--chevron-right] block size-6' />
              </motion.button>
            ) : null}
            {/* Close button */}
            <motion.button
              animate={{ opacity: 1 }}
              aria-label={t('common.close')}
              ref={closeRef}
              className='fixed top-4 right-4 z-50 cursor-pointer rounded-full bg-black/50 p-2 text-white hover:bg-black/70'
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              onClick={handleClose}
              type='button'
            >
              <span className='icon-[mdi--close] block size-6' />
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </RadixThemePortal>
  )
}
