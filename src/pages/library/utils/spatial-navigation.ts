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

/** Whether a move is up or down, while it's looking for where to go */
let movingVertically = false

/**
 * Up and down land only on something mostly in view: in a row that scrolls sideways, a picture cut off at its edge is
 * passed over for one beside it, rather than for whatever is below the row. Left and right still reach it, scrolling it
 * into view
 */
function isMostlyShown(element: HTMLElement) {
  if (!movingVertically) {
    return true
  }
  const row = element.parentElement?.closest<HTMLElement>('.overflow-x-auto, .overflow-x-scroll')
  if (!row) {
    return true
  }
  const shown = row.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  const across = Math.min(rect.right, shown.right) - Math.max(rect.left, shown.left)
  return across >= rect.width / 2
}

async function bringIntoView(element: unknown) {
  if (element instanceof HTMLElement) {
    // What the highlight is drawn around: a game's whole entry, with its console line, not only its link
    const box = (element.dataset.snFocusParent !== undefined && element.parentElement) || element
    await scrollIntoView(box, {
      block: 'center',
      duration: 300,
      scrollMode: 'if-needed',
      // Only what really scrolls: a clipped box, like Home's banner behind its art, would otherwise be nudged
      skipOverflowHiddenElements: true,
    })
    keepClearOfBottomBar(box)
  }
}

/**
 * A bar pinned to the bottom of the screen (the controller hints on a computer, the tabs on a phone) covers what's under
 * it, though that still counts as on screen, so the page scrolls on until what has the focus is clear of it
 */
function keepClearOfBottomBar(box: HTMLElement) {
  const bar = [...document.querySelectorAll<HTMLElement>('[data-sn-bottom-bar]')].find(
    (element) => element.getBoundingClientRect().height > 0,
  )
  if (!bar || box.closest('[data-sn-bottom-bar], [role="dialog"], [role="alertdialog"]')) {
    return
  }
  const rect = box.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  // Only what's beside the bar, not the sidebar to its left
  const besideBar = rect.right > barRect.left && rect.left < barRect.right
  const covered = rect.bottom + 8 - barRect.top
  if (besideBar && covered > 0) {
    globalThis.scrollBy({ behavior: 'smooth', top: covered })
  }
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
  const vertical = direction === 'up' || direction === 'down'
  return new Promise<void>((resolve) => {
    const abortController = new AbortController()
    let found = false
    async function handleWillFocus(event: Event) {
      found = true
      moving = true
      focus(currentActiveElement)
      const nextActiveElement = event.target
      event.preventDefault()
      // Up and down from the sidebar stay in it; left and right go to the page
      if (vertical && inSidebar(currentActiveElement) && !inSidebar(nextActiveElement)) {
        moving = false
        abortController.abort()
        resolve()
        return
      }
      await bringIntoView(nextActiveElement)
      focus(nextActiveElement)
      moving = false
      abortController.abort()
      resolve()
    }
    document.body.addEventListener('sn:willfocus', handleWillFocus, { capture: true, signal: abortController.signal })
    // Up and down from the page look only in the page: past its end isn't the sidebar's Settings
    document.documentElement.classList.toggle('sn-in-page', vertical && !inSidebar(currentActiveElement))
    sidewaysFrom = vertical || !(currentActiveElement instanceof HTMLElement) ? undefined : currentActiveElement
    movingVertically = vertical
    SpatialNavigation.move(direction)
    sidewaysFrom = undefined
    movingVertically = false
    document.documentElement.classList.remove('sn-in-page')
    // Nothing more that way: what's there is scrolled to its edge, so a heading or the end of a row can be seen
    if (!found) {
      abortController.abort()
      scrollToEdge(currentActiveElement, direction)
      resolve()
    }
  })
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

export function init() {
  SpatialNavigation.set({
    navigableFilter: (element: HTMLElement) => !holdsControls(element) && isBeside(element) && isMostlyShown(element),
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

export async function jump(direction?: Direction) {
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
  moving = true
  await bringIntoView(target)
  focus(target)
  moving = false
}
