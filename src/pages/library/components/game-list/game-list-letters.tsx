import { clsx } from 'clsx'
import { type FocusEvent, type PointerEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData, useNavigate } from 'react-router'
import type { RomLetter, RomLetterPage } from '#@/api/types.ts'
import { NavigatableLink } from '../navigatable-link.tsx'
import { usePageLink } from './game-list-pagination.tsx'

/** The letter a game's name is listed under */
export function letterOf(name = ''): RomLetter {
  const first = name.charAt(0).toLowerCase()
  return /[a-z]/u.test(first) ? first : '#'
}

/**
 * The letters down the right edge of a list sorted by name, staying in view as it scrolls. A letter goes to the page
 * its games start on. The letter under the pointer or finger grows, with a bubble saying which page it goes to; a
 * finger can slide down the letters and lift to go. With a gamepad or the keyboard, right from the games lands on the
 * current letter, up and down move between letters, and left goes back to the games
 */
export function GameListLetters({ current }: Readonly<{ current: RomLetter }>) {
  const { t } = useTranslation()
  const { letters } = useLoaderData<{ letters?: RomLetterPage[] }>()
  const pageLink = usePageLink()
  const navigate = useNavigate()
  const rail = useRef<HTMLElement>(null)
  const [pointed, setPointed] = useState<RomLetter>()
  // A finger lifted on a letter goes there itself; the click the browser sends after it is ignored
  const touchNavigated = useRef(false)

  if (!letters?.length) {
    return
  }

  const pointedIndex = letters.findIndex(({ letter }) => letter === pointed)
  const pointedPage = letters[pointedIndex]

  function letterAt(event: PointerEvent<HTMLElement>) {
    const box = rail.current?.getBoundingClientRect()
    if (!box) {
      return
    }
    const element = document.elementFromPoint(box.left + box.width / 2, event.clientY)
    const letter = element?.closest<HTMLElement>('[data-letter]')?.dataset.letter
    return letters?.find((page) => page.letter === letter && page.has)
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const found = letterAt(event)
    if (found) {
      setPointed(found.letter)
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') {
      event.currentTarget.setPointerCapture(event.pointerId)
      handlePointerMove(event)
    }
  }

  async function handlePointerUp(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') {
      return
    }
    const found = letterAt(event)
    setPointed(undefined)
    if (found) {
      touchNavigated.current = true
      await navigate(pageLink(found.page))
    }
  }

  // Coming onto the letters from the games, the focus starts on the current letter rather than the nearest one
  function handleFocus(event: FocusEvent<HTMLElement>) {
    const from = event.relatedTarget
    if (from instanceof Node && rail.current?.contains(from)) {
      return
    }
    const currentLink = rail.current?.querySelector<HTMLElement>(`[data-letter="${current}"] a`)
    if (currentLink && currentLink !== event.target) {
      currentLink.focus()
    }
  }

  return (
    <div className='sticky top-4 z-1 shrink-0 self-start'>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the letters are links; the strip follows a finger sliding across them */}
      <nav
        aria-label={t('pagination.jumpToLetter')}
        className='relative flex h-[min(34rem,calc(100dvh-24rem))] min-h-80 w-8 touch-none flex-col items-center justify-between rounded-full bg-(--gray-a3) py-2 select-none'
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node && rail.current?.contains(event.relatedTarget))) {
            setPointed(undefined)
          }
        }}
        onClickCapture={(event) => {
          if (touchNavigated.current) {
            touchNavigated.current = false
            event.preventDefault()
          }
        }}
        onFocus={handleFocus}
        onPointerDown={handlePointerDown}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') {
            setPointed(undefined)
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={rail}
      >
        {letters.map(({ has, letter, page }, index) => {
          const distance = pointedIndex === -1 ? Infinity : Math.abs(index - pointedIndex)
          const label = letter === '#' ? '#' : letter.toUpperCase()
          return (
            <div className='flex min-h-0 flex-1 items-center' data-letter={letter} key={letter}>
              {has ? (
                <NavigatableLink
                  aria-label={t('pagination.letterPage', { letter: label, page })}
                  className={clsx(
                    'flex h-4 w-6 items-center justify-center rounded text-[11px] leading-none font-semibold transition-transform outline-none',
                    letter === current ? 'bg-(--accent-9) text-white' : 'text-(--accent-11)',
                    { 'scale-125': distance === 1, 'scale-150': distance === 0 },
                  )}
                  data-sn-focus-style={JSON.stringify({ display: 'none' })}
                  onFocus={() => setPointed(letter)}
                  to={pageLink(page)}
                >
                  {label}
                </NavigatableLink>
              ) : (
                <span className='flex h-4 w-6 items-center justify-center text-[11px] leading-none text-(--gray-8)'>
                  {label}
                </span>
              )}
            </div>
          )
        })}

        {pointedPage ? (
          <div
            aria-hidden
            className='pointer-events-none absolute right-full mr-3 flex h-14 w-18 flex-col items-center justify-center rounded-lg bg-(--accent-9) text-white shadow-lg'
            style={{ top: `calc(${((pointedIndex + 0.5) / letters.length) * 100}% - 1.75rem)` }}
          >
            <span className='text-2xl leading-none font-bold'>
              {pointedPage.letter === '#' ? '#' : pointedPage.letter.toUpperCase()}
            </span>
            <span className='mt-1 text-[11px]'>{t('pagination.pageNumber', { page: pointedPage.page })}</span>
          </div>
        ) : null}
      </nav>
    </div>
  )
}
