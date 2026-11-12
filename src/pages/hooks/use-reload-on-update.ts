import { useEffect } from 'react'

// After the site is updated, a page that's already open keeps running the old build, whose files are gone from the
// server, so moving to another page fails. Ask the server now and then which build it runs, and once that has changed,
// let the next link click load its page in full from the new build instead of navigating in place.
const checkInterval = 5 * 60 * 1000

function getLinkToFollow(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || link.origin !== location.origin) {
    return
  }
  if (link.target && link.target !== '_self') {
    return
  }
  return link
}

export function useReloadOnUpdate() {
  useEffect(() => {
    // React Router puts the build's manifest, with its version, on the page
    const manifest = Reflect.get(globalThis, '__reactRouterManifest') as undefined | { version?: string }
    const runningVersion = manifest?.version
    if (!runningVersion) {
      return
    }

    let updated = false
    const abortController = new AbortController()
    const { signal } = abortController

    async function check() {
      if (updated || document.visibilityState !== 'visible') {
        return
      }
      try {
        const response = await fetch('/build-version', { cache: 'no-store', signal })
        const text = response.ok ? await response.text() : ''
        const version = text.trim()
        // Only a real build version counts, not a login page or an error
        if (/^[\da-f]{6,}$/u.test(version) && version !== runningVersion) {
          updated = true
        }
      } catch {}
    }

    function handleClick(event: MouseEvent) {
      if (updated && getLinkToFollow(event)) {
        // Keeps React Router from handling the click, so the browser loads the page itself
        event.stopPropagation()
      }
    }

    document.addEventListener('visibilitychange', check, { signal })
    globalThis.addEventListener('focus', check, { signal })
    globalThis.addEventListener('click', handleClick, { capture: true, signal })
    const timer = setInterval(check, checkInterval)
    return () => {
      abortController.abort()
      clearInterval(timer)
    }
  }, [])
}
