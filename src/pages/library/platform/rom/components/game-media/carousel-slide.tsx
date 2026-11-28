import { useTranslation } from 'react-i18next'
import { getFileExtension } from '../game-media-dialog/utils.ts'
import { CbzViewer } from './cbz-viewer.tsx'
import type { MediaItem } from './game-media-carousel.tsx'
import { convertYouTubeIframeURL, getYouTubeThumbnailUrl } from './youtube-utils.ts'

interface CarouselSlideProps {
  index: number
  item: MediaItem
  videoRefs: Map<number, HTMLVideoElement>
  youtubeRefs: Map<number, HTMLIFrameElement>
}

export function CarouselSlide({ index, item, videoRefs, youtubeRefs }: Readonly<CarouselSlideProps>) {
  const { t } = useTranslation()
  if (item.type === 'video') {
    return (
      <video
        aria-label={t('game.media.video')}
        controls
        className='h-full w-full object-contain'
        ref={(el) => {
          if (el) {
            videoRefs.set(index, el)
          } else {
            videoRefs.delete(index)
          }
        }}
        src={item.src}
      >
        <track kind='captions' />
      </video>
    )
  }

  // On a cross-origin isolated page (the PSP's game pages) YouTube's player can't be shown, so its thumbnail opens the
  // video on YouTube instead
  if (item.type === 'youtube' && globalThis.crossOriginIsolated) {
    return (
      <a
        className='relative flex h-full w-full items-center justify-center'
        href={item.src}
        rel='noreferrer noopener'
        target='_blank'
        title='YouTube'
      >
        <img alt='' className='h-full w-full object-contain' src={getYouTubeThumbnailUrl(item.src)} />
        <span className='absolute flex items-center gap-2 rounded-full bg-black/70 px-5 py-3 text-lg font-semibold text-white'>
          <span className='icon-[mdi--youtube] size-7 text-[#ff0033]' />
          YouTube
          <span className='icon-[mdi--open-in-new] size-5' />
        </span>
      </a>
    )
  }

  if (item.type === 'youtube') {
    return (
      <iframe
        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
        allowFullScreen
        className='h-full w-full border-none bg-black'
        ref={(el) => {
          if (el) {
            youtubeRefs.set(index, el)
          } else {
            youtubeRefs.delete(index)
          }
        }}
        referrerPolicy='strict-origin-when-cross-origin'
        sandbox='allow-same-origin allow-scripts allow-forms'
        src={convertYouTubeIframeURL(item.src)}
        title={t('game.media.youtubeVideo')}
      />
    )
  }

  if (item.type === 'image') {
    return <img alt='' className='h-full w-full object-contain' src={item.src} />
  }

  if (item.type === 'cbz') {
    return <CbzViewer src={item.src} />
  }

  if (item.type === 'pdf') {
    return <iframe className='h-full w-full border-none' src={item.src} title='PDF viewer' />
  }

  return (
    <div className='flex flex-col items-center justify-center gap-4'>
      <span className='icon-[mdi--file-document] size-24 text-white' />
      <span className='text-sm text-white uppercase'>{getFileExtension(item.src)}</span>
      <a
        className='rounded bg-neutral-700 px-4 py-2 text-sm text-white hover:bg-neutral-600'
        download
        href={item.src}
        rel='noreferrer noopener'
        target='_blank'
      >
        Download
      </a>
    </div>
  )
}
