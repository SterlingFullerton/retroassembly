import { clsx } from 'clsx'
import { noop } from 'es-toolkit'
import { useAtom } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { generatePath, useLocation, useNavigate } from 'react-router'
import useSWR from 'swr'
import { client, parseResponse } from '#@/api/client.ts'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { useSpatialNavigationPaused } from '#@/pages/library/atoms.ts'
import { useLibraryData } from '#@/pages/library/hooks/use-library-data.ts'
import { normalizeSearch, withSearch } from '#@/pages/library/hooks/use-library-search.ts'
import { useSearchCountsFor } from '#@/pages/library/hooks/use-search-counts.ts'
import { useViewport } from '#@/pages/library/hooks/use-viewport.ts'
import { routes } from '#@/pages/routes.ts'
import { PhoneSearchResult } from './phone-search-result.tsx'
import { addRecentSearch, readRecentSearches } from './recent-searches.ts'

// On a phone, search has a screen of its own over the page, opened from the red bar: results show straight under the box
// as you type, above the keyboard, and the page underneath doesn't change. The screen is part of the address (#search),
// so Back closes it, and Back from a game opened here comes back to the results

const searchHash = '#search'

function subscribeNever() {
  return noop
}

/** What's typed in the screen, and the console picked, kept while a game opened from it is shown */
// in this tab's session storage, since opening a PSP game loads the whole page afresh
const sessionStore = createJSONStorage<string>(() => sessionStorage)
const textAtom = atomWithStorage('retroassembly:phone-search-text', '', sessionStore, { getOnInit: true })
const platformAtom = atomWithStorage('retroassembly:phone-search-platform', '', sessionStore, { getOnInit: true })

const { $get } = client.roms.search

/** Opens the search screen, optionally with a search already typed */
export function useOpenPhoneSearch() {
  const location = useLocation()
  const navigate = useNavigate()
  const [, setText] = useAtom(textAtom)
  const [, setPlatform] = useAtom(platformAtom)
  return async function open(text?: string) {
    if (text !== undefined) {
      setText(text)
      setPlatform('')
    }
    if (location.hash !== searchHash) {
      await navigate({ ...location, hash: searchHash }, { state: { searchOpened: true } })
    }
  }
}

export function PhoneSearchScreen() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isNotLargeScreen } = useViewport()
  const { recentlyLaunchedRoms } = useLibraryData()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()
  const [text, setText] = useAtom(textAtom)
  const [platform, setPlatform] = useAtom(platformAtom)
  const inputRef = useRef<HTMLInputElement>(null)

  // Only once in the browser: the server can't see the #search in the address, so its page never has the screen
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const open = mounted && isNotLargeScreen && location.hash === searchHash

  // Searched a moment after typing stops
  const [query, setQuery] = useState(normalizeSearch(text))
  useEffect(() => {
    const timer = setTimeout(() => setQuery(normalizeSearch(text)), 250)
    return () => clearTimeout(timer)
  }, [text])

  // The gamepad's spatial navigation would take the arrow keys and Enter from the box
  useEffect(() => {
    setSpatialNavigationPaused(open)
  }, [open, setSpatialNavigationPaused])

  const counts = useSearchCountsFor(open ? query : '')
  const { data, isLoading } = useSWR(
    open && query
      ? { endpoint: 'roms/search', query: { page_size: '50', platform: platform || undefined, query } }
      : null,
    ({ query }) => parseResponse($get({ query })),
    { dedupingInterval: 60 * 1000, keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  if (!open) {
    return null
  }

  async function close() {
    // Back undoes opening the screen; opened from an address with #search already in it, it's taken out instead
    await ((location.state as { searchOpened?: boolean } | null)?.searchOpened
      ? navigate(-1)
      : navigate({ ...location, hash: '' }, { replace: true }))
  }

  function remember() {
    if (query) {
      addRecentSearch(query)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Search on the keyboard puts the keyboard away, showing more results
      event.preventDefault()
      setQuery(normalizeSearch(text))
      remember()
      event.currentTarget.blur()
    }
  }

  async function seeAll() {
    remember()
    const page = platform ? generatePath(routes.libraryPlatform, { platform }) : routes.libraryRoms
    // In place of the screen, so Back from the Games page goes back to where search was opened
    await navigate(withSearch(page, query), { replace: true })
  }

  const chips = counts
    ? [
        { count: counts.games, name: '' as const, text: t('search.allGames') },
        ...Object.entries(counts.platforms)
          .filter(([name, count]) => count > 0 && name in platformMap)
          .toSorted(([, a], [, b]) => b - a)
          .map(([name, count]) => ({
            count,
            name: name as PlatformName,
            text: t(platformMap[name as PlatformName].displayNameI18nKey),
          })),
      ]
    : []
  const results = query && data?.query === query ? data.roms : undefined
  const recentSearches = readRecentSearches()

  return (
    <div className='fixed inset-0 z-10 flex flex-col bg-(--color-background) lg:hidden'>
      <div className='px-safe-offset-2 flex items-center gap-2 bg-(--accent-9) py-2'>
        <button
          aria-label={t('common.back')}
          className='grid size-9 shrink-0 place-items-center text-white'
          onClick={close}
          type='button'
        >
          <span className='icon-[mdi--arrow-left] size-6' />
        </button>
        <div className='flex h-9 flex-1 items-center gap-2 rounded bg-white px-3 text-[#1d1d20]'>
          <span className='icon-[mdi--magnify] size-5 shrink-0 opacity-70' />
          <input
            aria-label={t('common.search')}
            autoComplete='off'
            autoFocus={!text}
            className='min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#8b8b93]'
            enterKeyHint='search'
            inputMode='search'
            onChange={(event) => {
              setText(event.currentTarget.value)
              setPlatform('')
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('search.searchYourGames')}
            ref={inputRef}
            spellCheck={false}
            type='text'
            value={text}
          />
          {text ? (
            <button
              aria-label={t('common.clear')}
              className='grid size-7 shrink-0 place-items-center opacity-60'
              onClick={() => {
                setText('')
                setPlatform('')
                inputRef.current?.focus()
              }}
              type='button'
            >
              <span className='icon-[mdi--close] size-5' />
            </button>
          ) : null}
        </div>
      </div>

      <div className='pb-safe-offset-4 flex-1 overflow-y-auto px-3 pt-2'>
        {query ? (
          <>
            {chips.length > 2 ? (
              <div className='scrollbar-on-hover -mx-3 mb-1 flex gap-2 overflow-x-auto px-3 py-1'>
                {chips.map(({ count, name, text: chipText }) => (
                  <button
                    className={clsx(
                      'shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap',
                      platform === name ? 'bg-(--accent-9) text-white' : 'bg-(--gray-3) text-(--gray-12)',
                    )}
                    key={name || 'all'}
                    onClick={() => setPlatform(name)}
                    type='button'
                  >
                    {chipText}
                    <b className={clsx('ml-1.5', platform === name ? 'text-white' : 'text-(--accent-11)')}>{count}</b>
                  </button>
                ))}
              </div>
            ) : null}

            {results?.length ? (
              <>
                <ul>
                  {results.map((rom) => (
                    <PhoneSearchResult keyword={query} key={rom.id} onOpen={remember} rom={rom} />
                  ))}
                </ul>
                <button className='w-full py-4 text-sm font-semibold text-(--accent-11)' onClick={seeAll} type='button'>
                  {t('search.seeAllOnGamesPage')}
                </button>
              </>
            ) : null}

            {results?.length === 0 && !isLoading ? (
              <p className='py-8 text-center text-sm text-(--gray-11)'>{t('search.noMatches', { query })}</p>
            ) : null}
          </>
        ) : (
          <>
            {recentSearches.length > 0 ? (
              <>
                <h3 className='mt-2 mb-1 text-xs font-bold tracking-wider text-(--gray-10) uppercase'>
                  {t('search.recentSearches')}
                </h3>
                <ul className='mb-3'>
                  {recentSearches.map((recent) => (
                    <li key={recent}>
                      <button
                        className='flex w-full items-center gap-3 py-2 text-left text-(--gray-12)'
                        onClick={() => setText(recent)}
                        type='button'
                      >
                        <span className='icon-[mdi--history] size-5 shrink-0 text-(--gray-10)' />
                        {recent}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {recentlyLaunchedRoms?.length ? (
              <>
                <h3 className='mt-2 mb-1 text-xs font-bold tracking-wider text-(--gray-10) uppercase'>
                  {t('search.recentlyPlayed')}
                </h3>
                <ul>
                  {recentlyLaunchedRoms.slice(0, 8).map((rom) => (
                    <PhoneSearchResult keyword='' key={rom.id} rom={rom} />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
