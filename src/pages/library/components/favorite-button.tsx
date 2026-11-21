import confetti from 'canvas-confetti'
import { clsx } from 'clsx'
import { useOptimistic, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'
import { metadata } from '#@/constants/metadata.ts'
import type { Rom } from '#@/pages/library/types.ts'
import { usePristine } from '../atoms.ts'
import { useLibraryRefresh } from '../hooks/use-library-refresh.ts'

interface FavoriteButtonProps {
  rom: Rom
  /** On a game's page (`inline`) or on a game entry's console line (`entry`) */
  variant: 'entry' | 'inline'
}

const heartPath =
  'm12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5C2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53z'
function showConfetti(element: HTMLElement, isTop: boolean) {
  const rect = element.getBoundingClientRect()
  const x = (rect.left + rect.width / 2) / globalThis.innerWidth
  const y = (rect.top + rect.height / 2) / globalThis.innerHeight
  const origin = { x, y }

  ;(async () => {
    await confetti({
      colors: [metadata.themeColor],
      disableForReducedMotion: true,
      gravity: isTop ? -0.5 : 0.5,
      origin,
      particleCount: 1,
      scalar: 1.5,
      shapes: [confetti.shapeFromPath(heartPath)],
      spread: 0,
      startVelocity: 0,
      ticks: 40,
    })
  })()
}
export function FavoriteButton({ rom, variant }: Readonly<FavoriteButtonProps>) {
  const { t } = useTranslation()
  const refresh = useLibraryRefresh()
  const [isPending, startTransition] = useTransition()
  const [optimisticIsFavorite, setOptimisticIsFavorite] = useOptimistic(
    rom.isFavorite,
    (_, nextState: boolean) => nextState,
  )

  const endpoint = client.favorites.$url({ param: { romId: rom.id } })
  const { trigger: add } = useSWRMutation({ endpoint, method: 'post' }, () =>
    client.favorites.$post({ json: { romId: rom.id } }),
  )

  const { trigger: remove } = useSWRMutation({ endpoint, method: 'delete' }, () =>
    client.favorites[':romId'].$delete({ param: { romId: rom.id } }),
  )

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (isPending) {
      return
    }

    const nextFavorite = !optimisticIsFavorite

    showConfetti(event.currentTarget, nextFavorite)

    startTransition(async () => {
      setOptimisticIsFavorite(nextFavorite)
      const prommise = rom.isFavorite ? remove() : add()
      await prommise
      await refresh()
    })
  }

  // Whether the arrow keys or a controller have been used, so the focus is being shown
  const [pristine] = usePristine()
  const label = optimisticIsFavorite ? t('game.removeFromFavorites') : t('game.addToFavorites')

  // On a game entry, a small heart at the end of its console line: filled for a favourite; empty, it shows on a computer
  // only while the pointer is over the game, or the game has the focus while moving with the keys, and on a phone always
  if (variant === 'entry') {
    return (
      <button
        aria-label={label}
        className={clsx(
          'taps-in-pass-through -mr-1.5 ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:bg-(--accent-3)',
          optimisticIsFavorite
            ? 'text-(--accent-9)'
            : [
                'text-(--gray-9) hover:text-(--accent-9) [@media(hover:hover)]:lg:opacity-0 [@media(hover:hover)]:lg:group-hover:opacity-100',
                { '[@media(hover:hover)]:lg:group-focus-within:opacity-100': !pristine },
              ],
        )}
        data-sn-skip=''
        onClick={handleClick}
        title={label}
        type='button'
      >
        <span
          className={clsx(
            'size-5 lg:size-[18px]',
            optimisticIsFavorite ? 'icon-[mdi--heart]' : 'icon-[mdi--heart-outline]',
          )}
        />
      </button>
    )
  }

  return (
    <button
      className='taps-in-pass-through relative z-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-(--color-background) ring-1 ring-(--gray-4) hover:bg-(--accent-3) hover:ring-(--accent-3) md:size-auto md:p-1.5'
      aria-label={label}
      onClick={handleClick}
      title={label}
      type='button'
    >
      <span
        className={clsx('text-lg text-(--accent-9)', {
          'icon-[mdi--heart-outline]': !optimisticIsFavorite,
          'icon-[mdi--heart]': optimisticIsFavorite,
        })}
      />
    </button>
  )
}
