import { expect, mergeTests, type Page } from '@playwright/test'
import { test as pagesTest } from '../fixtures/pages.ts'
import { test as romsTest } from '../fixtures/roms.ts'
import { test as userTest } from '../fixtures/user.ts'

const test = mergeTests(pagesTest, romsTest, userTest)

// A game draws its first screens a moment after it starts, so its screen is looked at again until it's the one expected
async function expectScreen(page: Page) {
  await expect(async () => {
    await expect(page).toHaveScreenshot()
  }).toPass({ timeout: 15_000 })
}

test('launch a game', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')
  await expectScreen(page)
  await page.keyboard.press('ArrowDown', { delay: 100 })
  await expectScreen(page)
})

test('continue a game', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')
  await expectScreen(page)
  await page.keyboard.press('ArrowDown', { delay: 100 })
  await expectScreen(page)

  await page.keyboard.press('Escape')
  await page.getByTestId('pause-exit').click()
  await page.getByTestId('pause-save-exit').click()
  await page.locator('#canvas').waitFor({ state: 'detached' })
  await library.launchGame('continue')
  await expectScreen(page)
})

test('pause and resume game', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')

  await page.keyboard.press('Escape')
  await expect(page.getByText('resume')).toBeVisible()

  await page.getByText('resume').click()

  await expect(page.getByText('resume')).not.toBeVisible()
})

test('restart game during gameplay', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')

  await page.keyboard.press('Escape')
  await page.getByTestId('pause-exit').click()
  await page.getByTestId('pause-restart').click()

  await page.keyboard.press('Escape')
  await expect(page.getByText('resume')).toBeVisible()
})

test('exit game without saving', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')

  await page.keyboard.press('Escape')
  await page.getByTestId('pause-exit').click()
  await page.getByTestId('pause-exit-now').click()

  await expect(page.locator('#canvas')).not.toBeVisible()
})
