import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shaders } from '#@/consoles/shaders.ts'

/** An example of a shader at work, from libretro's documentation, or a note that there's none. Nothing for no shader */
export function ShaderPreview({ shader }: Readonly<{ shader: string }>) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState('')
  const found = shaders.find(({ id }) => id === shader)

  if (!found?.id) {
    return
  }

  return (
    <figure className='mt-2 max-w-80'>
      <div className='relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-(--gray-a3)'>
        {found.thumbnail ? (
          <img
            alt={found.name}
            className={clsx('size-full object-contain transition-opacity', {
              'opacity-0': loaded !== found.thumbnail,
            })}
            key={found.thumbnail}
            onLoad={() => setLoaded(found.thumbnail)}
            src={found.thumbnail}
          />
        ) : (
          <span className='flex flex-col items-center gap-2 px-4 text-center text-sm text-(--gray-11)'>
            <span className='icon-[mdi--image-off-outline] size-8' />
            {t('settings.noShaderPreview')}
          </span>
        )}
        {found.thumbnail && loaded !== found.thumbnail ? (
          <span className='absolute inset-0 bg-(--gray-a3) motion-safe:animate-pulse' />
        ) : null}
      </div>
      <figcaption className='mt-1 text-xs text-(--gray-11)'>{found.name}</figcaption>
    </figure>
  )
}
