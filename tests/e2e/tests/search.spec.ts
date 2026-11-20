import { setTimeout } from 'node:timers/promises'
import { expect, mergeTests, type Page } from '@playwright/test'
import { test as pagesTest } from '../fixtures/pages.ts'
import { test as romsTest } from '../fixtures/roms.ts'
import { test as userTest } from '../fixtures/user.ts'

const test = mergeTests(pagesTest, romsTest, userTest)

// The sidebar's search box. A phone has a search button and a screen of its own instead
function searchBox(page: Page) {
  return page.getByRole('textbox', { name: 'Search' })
}

// A game in the list the search shows its matches in
function gameEntry(page: Page, title: string) {
  return page.locator('.game-entry').filter({ hasText: title })
}

test('search for rom by title', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms)
  const [rom, other] = roms
  await searchBox(page).fill(rom.title)
  await expect(gameEntry(page, rom.title)).toBeVisible()
  await expect(gameEntry(page, other.title)).toHaveCount(0)
})

test('search with no results', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))
  await searchBox(page).fill('nonexistentrom12345')
  await expect(page.getByText('No games match “nonexistentrom12345”')).toBeVisible()
  await expect(page.locator('.game-entry')).toHaveCount(0)
})

test('launch game from search results', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms)
  const [rom] = roms
  await searchBox(page).fill(rom.title)
  await gameEntry(page, rom.title).click()
  await expect(page.getByText('start')).toBeVisible()
})

test('navigate search results with keyboard', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms)
  const [rom] = roms
  await searchBox(page).fill(rom.title)
  await expect(gameEntry(page, rom.title)).toBeVisible()
  // Enter in the search box goes into the first game, and Enter there opens it
  await searchBox(page).press('Enter')
  await expect(gameEntry(page, rom.title)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('start')).toBeVisible()
})

test('enter goes into the search results while they are still loading', async ({
  page,
  pages: { library, login },
  roms,
  user,
}) => {
  await login.login(user)
  await library.uploadROMs(roms)
  const rom = roms.at(-1)
  if (!rom) {
    throw new Error('No test games')
  }
  // The results take longer than the pause before typing is searched for, so Enter arrives while they load
  await page.route('**/api/v1/pages/library/roms*', async (route) => {
    await setTimeout(1500)
    await route.continue()
  })
  await searchBox(page).fill(rom.title)
  await page.waitForTimeout(500)
  await searchBox(page).press('Enter')
  await expect(gameEntry(page, rom.title)).toBeFocused()
})
