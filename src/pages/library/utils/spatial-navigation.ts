import scrollIntoView from 'smooth-scroll-into-view-if-needed'
import SpatialNavigation, { type Direction } from 'spatial-navigation-ts'

/**
 * What the arrow keys and a gamepad move between: every link, button and box on the page, so nothing that can be clicked
 * is out of their reach, except what's marked `data-sn-skip` (each game's heart and menu in a list, which its own page
 * has, so a grid takes one press a game) and what's hidden, such as the unseen box behind each checkbox
 */
export const navigableSelector =
  ':is(a[href], button, input:not([type="hidden"]), select, textarea, [role="combobox"], [tabindex]:not([tabindex="-1"]), [data-sn-enabled]):not([data-sn-skip], [disabled], [aria-hidden="true"])'

/** A box made focusable only to hold controls, such as a group of checkboxes, is passed over for the controls in it */
function holdsControls(element: HTMLElement) {
  return !element.matches('a, button, input, select, textarea') && Boolean(element.querySelector(navigableSelector))
}

export function isNavigable(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(navigableSelector) && !holdsControls(element)
}

function isFocusable(element: unknown): element is HTMLElement {
  const focusableElements = [
    HTMLAnchorElement,
    HTMLButtonElement,
    HTMLInputElement,
    HTMLSelectElement,
    HTMLTextAreaElement,
  ]
  const focusable =
    focusableElements.some((clazz) => element instanceof clazz) ||
    (element instanceof HTMLElement && element.getAttribute('tabindex'))
  if (!focusable || !(element instanceof HTMLElement) || !element.isConnected) {
    return false
  }
  if ('disabled' in element && element.disabled) {
    return false
  }
  return true
}

export function click(element: unknown) {
  const focusable = isFocusable(element)
  if (focusable) {
    element.click()
  }
}

export function focus(element: unknown) {
  if (typeof element === 'string') {
    focus(document.body.querySelector(element))
    return
  }
  if (element === document.activeElement) {
    return
  }
  const focusable = isFocusable(element)
  if (focusable) {
    element.focus({ preventScroll: true })
  }
}

const dialogSelector = '[role="dialog"], [role="alertdialog"]'

/** The dialog on top, such as Settings, when one is open */
function openDialog() {
  return [...document.querySelectorAll<HTMLElement>(dialogSelector)].at(-1)
}

/** Whether a dialog is open with the focus in it (or nowhere): the keys then move in the dialog, and back closes it */
export function isInDialog() {
  const { activeElement } = document
  if (activeElement instanceof HTMLElement && activeElement.closest(dialogSelector)) {
    return true
  }
  return Boolean(openDialog()) && (!activeElement || activeElement === document.body)
}

/** Whether the focus is in an open menu or list, such as Sort's, which moves with its own keys */
export function isInMenu() {
  const { activeElement } = document
  return (
    activeElement instanceof HTMLElement &&
    Boolean(activeElement.closest('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'))
  )
}

/** Sends a key to the open menu, as if it were pressed: how a gamepad, or a remapped key, works a menu */
export function pressInMenu(key: string) {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
}

/**
 * Whether the arrow keys on this control are for moving around, rather than for the control itself. Controls that take
 * the arrows (a menu button opens its menu, a group of checkboxes, tabs or options steps through them in reading order)
 * don't get them, so up is always up; a slider keeps left and right, to change it
 */
export function isArrowForMoving(element: unknown, key: string) {
  if (!(element instanceof HTMLElement) || isInMenu() || element.closest('.game-overlay')) {
    return false
  }
  if (!element.closest(`.library-layout, ${dialogSelector}`)) {
    return false
  }
  const sideways = key === 'ArrowLeft' || key === 'ArrowRight'
  return !(sideways && element.matches('[role="slider"], [data-sn-adjust]'))
}

type CancelHandler = () => void
let cancelHandler: CancelHandler | undefined
export function onCancel(handler: CancelHandler) {
  cancelHandler = handler
}
export function offCancel() {
  cancelHandler = undefined
}
export function cancel() {
  try {
    if (cancelHandler) {
      cancelHandler()
    } else {
      globalThis.history.back()
    }
  } catch {}
}

function inSidebar(element: unknown) {
  return element instanceof HTMLElement && Boolean(element.closest('aside'))
}

/** Where a left or right move starts from, while it's looking for where to go */
let sidewaysFrom: HTMLElement | undefined

/**
 * Left and right go only to something beside you, in the same row: at the end of a row the focus stays there, rather
 * than jumping to the row above or its "See all". Going between the page and the sidebar is the exception
 */
function isBeside(element: HTMLElement) {
  if (!sidewaysFrom || inSidebar(sidewaysFrom) !== inSidebar(element)) {
    return true
  }
  const from = sidewaysFrom.getBoundingClientRect()
  const to = element.getBoundingClientRect()
  return to.bottom > from.top + 1 && to.top < from.bottom - 1
}

/** How much of a picture its row shows, across */
function shownFraction(rect: DOMRect, shown: DOMRect) {
  return (Math.min(rect.right, shown.right) - Math.max(rect.left, shown.left)) / Math.max(rect.width, 1)
}

/**
 * Up and down go to the nearest row, then land on something mostly in view in it: a picture cut off at a sideways row's
 * edge gives way to the nearest one beside it that's shown. Leaving cut-off pictures out of the search instead could pass
 * over the whole row for one further down. Left and right still reach a cut-off picture, scrolling it into view
 */
function shownInRow(element: unknown) {
  if (!(element instanceof HTMLElement)) {
    return element
  }
  const row = element.parentElement?.closest<HTMLElement>('.overflow-x-auto, .overflow-x-scroll')
  if (!row) {
    return element
  }
  const shown = row.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  if (shownFraction(rect, shown) >= 0.5) {
    return element
  }
  const center = rect.left + rect.width / 2
  let best: HTMLElement | undefined
  let bestDistance = Infinity
  for (const candidate of row.querySelectorAll<HTMLElement>(navigableSelector)) {
    const candidateRect = candidate.getBoundingClientRect()
    const level = candidateRect.bottom > rect.top && candidateRect.top < rect.bottom
    const distance = Math.abs(candidateRect.left + candidateRect.width / 2 - center)
    if (isNavigable(candidate) && level && shownFraction(candidateRect, shown) >= 0.5 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ?? element
}

/**
 * Brings what has the focus into view: a game's whole entry, with its console line, not only its link. The browser
 * scrolls smoothly by itself, so another press can head somewhere else straight away and the scrolling changes course,
 * rather than each press waiting for the last to finish
 */
function bringIntoView(element: unknown) {
  if (!(element instanceof HTMLElement)) {
    return
  }
  const box = (element.dataset.snFocusParent !== undefined && element.parentElement) || element
  const behavior: ScrollBehavior = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
  scrollIntoView(box, {
    behavior(actions) {
      let pageTop: number | undefined
      for (const { el, left, top } of actions) {
        if (el === document.scrollingElement || el === document.documentElement) {
          pageTop = top
        } else {
          el.scroll({ behavior, left, top })
        }
      }
      // Where the page is heading, moved on so what has the focus is clear of a bar pinned to the bottom of the screen
      const target = pageTop ?? globalThis.scrollY
      const top = target + Math.max(0, coveredByBottomBar(box, target - globalThis.scrollY))
      if (Math.round(top) !== Math.round(globalThis.scrollY)) {
        globalThis.scrollTo({ behavior, top })
      }
    },
    block: 'center',
    scrollMode: 'if-needed',
    // Only what really scrolls: a clipped box, like Home's banner behind its art, would otherwise be nudged
    skipOverflowHiddenElements: true,
  })
}

/**
 * How much of a box a bar pinned to the bottom of the screen (the controller hints on a computer, the tabs on a phone)
 * would cover once the page has scrolled by `pageShift`; that still counts as on screen otherwise
 */
function coveredByBottomBar(box: HTMLElement, pageShift: number) {
  const bar = [...document.querySelectorAll<HTMLElement>('[data-sn-bottom-bar]')].find(
    (element) => element.getBoundingClientRect().height > 0,
  )
  if (!bar || box.closest('[data-sn-bottom-bar], [role="dialog"], [role="alertdialog"]')) {
    return 0
  }
  const rect = box.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  // Only what's beside the bar, not the sidebar to its left
  if (rect.right <= barRect.left || rect.left >= barRect.right) {
    return 0
  }
  return rect.bottom - pageShift + 8 - barRect.top
}

let moving = false
export function move(direction?: Direction) {
  if (moving || !direction) {
    return
  }
  // With nothing chosen yet, the first press only shows where you are, on the first thing on the page
  const before = document.activeElement
  resetFocus()
  if (!document.activeElement || document.activeElement !== before) {
    return
  }
  const currentActiveElement = document.activeElement
  // A control that left and right change, such as the volume, is told which way instead of losing the focus
  if (
    (direction === 'left' || direction === 'right') &&
    currentActiveElement instanceof HTMLElement &&
    currentActiveElement.dataset.snAdjust !== undefined
  ) {
    currentActiveElement.dispatchEvent(new CustomEvent('sn:adjust', { detail: direction }))
    return
  }
  // Along a row that scrolls sideways, the next game in it, even while it's still hidden past the row's edge because the
  // row is catching up with quick presses; the sidebar or the edge only once the row has no more that way
  const inRow = nextInRow(currentActiveElement, direction)
  if (inRow) {
    focus(inRow)
    bringIntoView(inRow)
    return
  }
  // Right past a row's last game stays on it, with the row at its end, rather than looking around the page for
  // something further right, which can land below the row. Left past the first still goes to the sidebar
  if (inRow === null && direction === 'right') {
    scrollToEdge(currentActiveElement, direction)
    return
  }
  const vertical = direction === 'up' || direction === 'down'
  return new Promise<void>((resolve) => {
    const abortController = new AbortController()
    let found = false
    function handleWillFocus(event: Event) {
      found = true
      moving = true
      focus(currentActiveElement)
      const nextActiveElement = vertical ? shownInRow(event.target) : event.target
      event.preventDefault()
      // Up and down from the sidebar stay in it; left and right go to the page
      if (vertical && inSidebar(currentActiveElement) && !inSidebar(nextActiveElement)) {
        moving = false
        abortController.abort()
        resolve()
        return
      }
      // The focus moves first, so the highlight heads straight for what's next while a row or the page scrolls it into
      // view, rather than riding along with what was focused and jumping once the scrolling stops
      focus(nextActiveElement)
      bringIntoView(nextActiveElement)
      moving = false
      abortController.abort()
      resolve()
    }
    document.body.addEventListener('sn:willfocus', handleWillFocus, { capture: true, signal: abortController.signal })
    // Up and down from the page look only in the page: past its end isn't the sidebar's Settings
    document.documentElement.classList.toggle('sn-in-page', vertical && !inSidebar(currentActiveElement))
    sidewaysFrom = vertical || !(currentActiveElement instanceof HTMLElement) ? undefined : currentActiveElement
    SpatialNavigation.move(direction)
    sidewaysFrom = undefined
    document.documentElement.classList.remove('sn-in-page')
    // Nothing more that way: what's there is scrolled to its edge, so a heading or the end of a row can be seen
    if (!found) {
      abortController.abort()
      scrollToEdge(currentActiveElement, direction)
      resolve()
    }
  })
}

/**
 * For left and right in a row that scrolls sideways: its nearest game (or picture) that way, level with this one; `null`
 * at the row's end
 */
function nextInRow(from: Element, direction: Direction) {
  if ((direction !== 'left' && direction !== 'right') || !(from instanceof HTMLElement)) {
    return
  }
  const row = from.parentElement?.closest<HTMLElement>('.overflow-x-auto, .overflow-x-scroll, .rt-ScrollAreaViewport')
  // Home's rows count even when they fit without scrolling. A Radix scrolling box only when it scrolls sideways, like a
  // game's screenshots: one that scrolls up and down, like the sidebar's consoles or a dialog, isn't a row
  if (!row || inSidebar(from) || (row.matches('.rt-ScrollAreaViewport') && !scrollsAlong(row, false))) {
    return
  }
  const here = from.getBoundingClientRect()
  const center = here.left + here.width / 2
  let best: HTMLElement | undefined
  let bestDistance = Infinity
  for (const candidate of row.querySelectorAll<HTMLElement>(navigableSelector)) {
    if (candidate === from || !isNavigable(candidate) || candidate.dataset.snSkip !== undefined) {
      continue
    }
    const rect = candidate.getBoundingClientRect()
    const level = rect.bottom > here.top && rect.top < here.bottom
    const distance = (rect.left + rect.width / 2 - center) * (direction === 'right' ? 1 : -1)
    if (level && distance > 1 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  // None that way in the row: `null`, as against `undefined` for not being in a row at all
  return best ?? null
}

function scrollsAlong(element: HTMLElement, vertical: boolean) {
  const overflow = getComputedStyle(element)[vertical ? 'overflowY' : 'overflowX']
  const room = vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
  return room > 1 && (overflow === 'auto' || overflow === 'scroll')
}

/**
 * Scrolls what holds the focus as far as it goes in a direction: a row that scrolls sideways for left and right, a
 * scrolling box (a dialog, the sidebar) or else the page for up and down. Nothing scrolls where nothing can
 */
function scrollToEdge(from: Element, direction: Direction) {
  const vertical = direction === 'up' || direction === 'down'
  const toStart = direction === 'up' || direction === 'left'
  let box: HTMLElement | undefined
  for (let node = from.parentElement; node && node !== document.body; node = node.parentElement) {
    if (scrollsAlong(node, vertical)) {
      box = node
      break
    }
    // Something fixed, like the sidebar or a game's menu, doesn't move with the page
    if (getComputedStyle(node).position === 'fixed') {
      return
    }
  }
  if (box) {
    const end = vertical ? box.scrollHeight : box.scrollWidth
    box.scrollTo({ behavior: 'smooth', [vertical ? 'top' : 'left']: toStart ? 0 : end })
  } else if (vertical) {
    globalThis.scrollTo({ behavior: 'smooth', top: toStart ? 0 : document.documentElement.scrollHeight })
  }
}

export function resetFocus({ force }: { force?: boolean } = {}) {
  // In a dialog, its first control
  const dialog = openDialog()
  if (dialog) {
    if (!isNavigable(document.activeElement) || !dialog.contains(document.activeElement)) {
      focus([...dialog.querySelectorAll(navigableSelector)].find((element) => isNavigable(element)))
    }
    return
  }
  if (!isNavigable(document.activeElement) || force) {
    // The first thing on the page to go to: Continue or Start where there's a game to play, then the first game in a
    // list, then anything in the page, such as the first console on the Consoles page, then where you are in the sidebar
    const selectors = ['.launch-button', '.game-entry', `main ${navigableSelector}`, '.sidebar-link.active']
    for (const selector of selectors) {
      const element = [...document.querySelectorAll(selector)].find((candidate) => isNavigable(candidate))
      if (element) {
        focus(element)
        return
      }
    }
  }
}

// A page drawn over the whole library, such as the join page, marked `data-sn-layer`: while it's there, only its own
// controls (and a dialog's) can be moved to
const layerSelector = '[data-sn-layer]'

function inTopLayer(element: HTMLElement) {
  const layer = [...document.querySelectorAll<HTMLElement>(layerSelector)].at(-1)
  return !layer || layer.contains(element) || Boolean(element.closest(dialogSelector))
}

/**
 * Makes everything in the library's layout around `layer` unreachable while it's over it: by the arrows, Tab and a
 * screen reader alike, as if it weren't there. Returns how to give it back
 */
export function holdLayer(layer: HTMLElement) {
  const held: HTMLElement[] = []
  for (let node = layer; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true
        held.push(sibling)
      }
    }
    if (node.parentElement.matches('.library-layout')) {
      break
    }
  }
  return () => {
    for (const element of held) {
      element.inert = false
    }
  }
}

export function init() {
  SpatialNavigation.set({
    navigableFilter: (element: HTMLElement) =>
      !holdsControls(element) && isBeside(element) && inTopLayer(element) && !element.closest('[inert]'),
  })

  SpatialNavigation.add({
    restrict: 'self-only',
    // the sidebar is left out while moving up or down in the page (see move)
    selector: `.library-layout ${navigableSelector}:not(html.sn-in-page aside *)`,
  })

  SpatialNavigation.add({
    restrict: 'self-only',
    selector: '.game-overlay [data-sn-enabled]',
  })

  // a dialog, such as Settings: the keys move only in it
  SpatialNavigation.add({
    restrict: 'self-only',
    selector: `:is(${dialogSelector}) ${navigableSelector}`,
  })

  // game-overlay
  resetFocus()
}

// Shift and an arrow (or a gamepad's shoulder buttons) jump instead of stepping: up and down to the previous or next part
// of the page, such as Home's rows or a list's games, and left and right to the ends of the row. A part taller than the
// screen is jumped through a screen at a time

const sectionSelector = '[data-sn-section]'

/** The dialog, sidebar or page the element is in: jumps stay in it */
function areaOf(element: HTMLElement) {
  return element.closest<HTMLElement>(`${dialogSelector}, aside, main`)
}

function shown(element: HTMLElement) {
  return element.offsetWidth > 0 && element.offsetHeight > 0
}

function controlsIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(navigableSelector)].filter(
    (element) => isNavigable(element) && shown(element),
  )
}

/** The part of the page the element is in, or the whole area where it isn't in one */
function sectionOf(element: HTMLElement, area: HTMLElement) {
  const section = element.closest<HTMLElement>(sectionSelector)
  return section && area.contains(section) ? section : area
}

function centreAcross(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return rect.left + rect.width / 2
}

/** The nearest control in the row the element is in, by how far across it is from x */
function nearestAcross(candidates: HTMLElement[], x: number) {
  return candidates.toSorted((a, b) => Math.abs(centreAcross(a) - x) - Math.abs(centreAcross(b) - x))[0]
}

/** A screen further down (or up) in a part taller than the screen, as near across as can be */
function aScreenOn(current: HTMLElement, section: HTMLElement, step: 1 | -1) {
  const from = current.getBoundingClientRect()
  const distance = window.innerHeight * 0.8
  const candidates = controlsIn(section).filter((element) => {
    const rect = element.getBoundingClientRect()
    return step === 1 ? rect.top >= from.top + distance : rect.bottom <= from.bottom - distance
  })
  if (candidates.length === 0) {
    return
  }
  const tops = candidates.map((element) => element.getBoundingClientRect().top)
  const rowTop = step === 1 ? Math.min(...tops) : Math.max(...tops)
  const row = candidates.filter((element) => Math.abs(element.getBoundingClientRect().top - rowTop) < 4)
  return nearestAcross(row, from.left + from.width / 2)
}

/** The first control of the next (or previous) part of the page */
function nextSection(current: HTMLElement, area: HTMLElement, step: 1 | -1) {
  const section = sectionOf(current, area)
  const from = current.getBoundingClientRect()
  const bounds = section.getBoundingClientRect()
  const tall =
    step === 1
      ? bounds.bottom > from.bottom + window.innerHeight * 0.8
      : bounds.top < from.top - window.innerHeight * 0.8
  if (tall) {
    const target = aScreenOn(current, section, step)
    if (target) {
      return target
    }
  }
  // Parts side by side, like Favorites and Recently added, are one step: the next is the nearest wholly below (above)
  const sections = [...area.querySelectorAll<HTMLElement>(sectionSelector)].filter(
    (other) =>
      other !== section && !other.contains(section) && !section.contains(other) && controlsIn(other).length > 0,
  )
  const beyond = sections
    .filter((other) => {
      const rect = other.getBoundingClientRect()
      return step === 1 ? rect.top >= bounds.bottom - 4 : rect.bottom <= bounds.top + 4
    })
    .toSorted((a, b) => {
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const gap = step === 1 ? ra.top - rb.top : rb.bottom - ra.bottom
      // the same distance: the one under (over) where you are
      return Math.abs(gap) > 4 ? gap : Math.abs(ra.left - from.left) - Math.abs(rb.left - from.left)
    })
  const next = beyond[0]
  return next ? landingIn(next) : undefined
}

/** Where a jump into a part lands: Continue or Start in the banner, else its first game rather than its heading's "See all" */
function landingIn(section: HTMLElement) {
  const controls = controlsIn(section)
  return (
    controls.find((element) => element.matches('.launch-button')) ??
    controls.find((element) => !element.closest('[data-sn-heading]')) ??
    controls[0]
  )
}

/** The control at the far end of the row the element is in */
function rowEnd(current: HTMLElement, area: HTMLElement, step: 1 | -1) {
  const from = current.getBoundingClientRect()
  const row = controlsIn(area).filter((element) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > from.top + 1 && rect.top < from.bottom - 1
  })
  const lefts = row.map((element) => element.getBoundingClientRect().left)
  const edge = step === 1 ? Math.max(...lefts) : Math.min(...lefts)
  return row.find((element) => element.getBoundingClientRect().left === edge)
}

export function jump(direction?: Direction) {
  if (moving || !direction) {
    return
  }
  const before = document.activeElement
  resetFocus()
  const current = document.activeElement
  if (!(current instanceof HTMLElement) || current !== before) {
    return
  }
  const area = areaOf(current)
  if (!area) {
    return move(direction)
  }
  const step = direction === 'down' || direction === 'right' ? 1 : -1
  const target =
    direction === 'up' || direction === 'down' ? nextSection(current, area, step) : rowEnd(current, area, step)
  if (!target || target === current) {
    // Already at the start of the row: on to the sidebar, as left does
    if (direction === 'left') {
      return move(direction)
    }
    return
  }
  focus(target)
  bringIntoView(target)
}
