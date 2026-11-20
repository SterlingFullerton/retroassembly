import { clsx } from 'clsx'
import { attemptAsync } from 'es-toolkit'
import { type KeyboardEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigation } from 'react-router'
import { normalizeSearch, useLibrarySearch } from '../../hooks/use-library-search.ts'
import { useViewport } from '../../hooks/use-viewport.ts'
import { focus } from '../../utils/spatial-navigation.ts'
import { useOpenPhoneSearch } from './phone-search/phone-search-screen.tsx'

const fieldName = 'library-search'

/**
 * The library's search box, in the sidebar at the top of the menu. What's typed is searched for a moment after typing
 * stops. Phones have a search screen of their own instead
 */
export function SearchField() {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const { apply, query } = useLibrarySearch()

  const [text, setText] = useState(query)
  // The search changed some other way (cleared, Back, a link): show it, unless it's what's being typed
  const [shown, setShown] = useState(query)
  if (query !== shown) {
    setShown(query)
    if (query !== normalizeSearch(text)) {
      setText(query)
    }
  }

  const applyTyped = useEffectEvent((value: string) => {
    if (normalizeSearch(value) !== query) {
      queueMicrotask(() => attemptAsync(() => apply(value)))
    }
  })
  useEffect(() => {
    const timer = setTimeout(() => applyTyped(text), 300)
    return () => clearTimeout(timer)
  }, [text])

  // The search the page shows. It's in the address only once its games have loaded, unlike the search asked for, which
  // changes the moment it's asked for, and unlike the loading state, which React Router draws a little later
  const { search } = useLocation()
  const shownQuery = normalizeSearch(new URLSearchParams(search).get('q') ?? '')

  // After Enter, the search whose first game to go into, once its games are shown
  const focusAfterSearch = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (focusAfterSearch.current === shownQuery && navigation.state === 'idle') {
      focusAfterSearch.current = undefined
      focus('.game-entry')
    }
  }, [navigation.state, shownQuery])

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || (event.key === 'ArrowDown' && text)) {
      event.preventDefault()
      const typed = normalizeSearch(text)
      if (typed === shownQuery && navigation.state === 'idle') {
        focus('.game-entry')
        return
      }
      focusAfterSearch.current = typed
      // Unless it's already been asked for, and is loading
      if (typed !== query) {
        await apply(text)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (text) {
        setText('')
        await apply('')
      } else {
        event.currentTarget.blur()
      }
    }
  }

  async function clear() {
    setText('')
    await apply('')
    focus(`input[name="${fieldName}"]`)
  }

  const searching = navigation.state === 'loading' && new URLSearchParams(navigation.location?.search).has('q')
  const active = Boolean(text)

  return (
    <div
      className={clsx(
        'group/search flex items-center gap-2 rounded border px-3 transition-colors',
        'h-10',
        // White with dark text in light and dark themes alike, standing out against the red around it
        active && 'border-transparent bg-white text-[#1d1d20]',
        !active &&
          'border-white/30 bg-white/15 text-white focus-within:border-transparent focus-within:bg-white focus-within:text-[#1d1d20]',
      )}
    >
      {searching ? (
        <span className='icon-[svg-spinners--180-ring] size-4 shrink-0' />
      ) : (
        <span className='icon-[mdi--magnify] size-5 shrink-0 opacity-80' />
      )}
      <input
        aria-label={t('common.search')}
        autoComplete='off'
        className={clsx(
          'h-full min-w-0 flex-1 bg-transparent text-sm outline-none',
          active
            ? 'placeholder:text-[#8b8b93]'
            : 'placeholder:text-white/85 group-focus-within/search:placeholder:text-[#8b8b93]',
        )}
        data-sn-enabled
        // The keyboard and controller highlight goes around the whole box, with its magnifier, not only the text
        data-sn-focus-parent
        enterKeyHint='search'
        name={fieldName}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('common.search')}
        spellCheck={false}
        inputMode='search'
        type='text'
        value={text}
      />
      {text ? (
        <button
          aria-label={t('common.clear')}
          className='-mr-1 grid size-6 shrink-0 place-items-center rounded opacity-60 hover:opacity-100'
          onClick={clear}
          title={t('common.clear')}
          type='button'
        >
          <span className='icon-[mdi--close] size-4' />
        </button>
      ) : null}
    </div>
  )
}

/** / or Cmd or Ctrl + K, anywhere in the library, goes to the search box: the sidebar's, or on a phone the red bar's */
export function useSearchShortcut() {
  const { isLargeScreen } = useViewport()
  const openPhoneSearch = useOpenPhoneSearch()

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
      const slash = event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey
      const commandK = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)
      if (!slash && !commandK) {
        return
      }
      event.preventDefault()
      if (isLargeScreen) {
        focus(`input[name="${fieldName}"]`)
      } else {
        queueMicrotask(() => attemptAsync(openPhoneSearch))
      }
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  })
}
