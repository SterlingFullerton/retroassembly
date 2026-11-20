import { expect, mergeTests } from '@playwright/test'
import { test as pagesTest } from '../fixtures/pages.ts'
import { test as romsTest } from '../fixtures/roms.ts'
import { test as userTest } from '../fixtures/user.ts'

const test = mergeTests(pagesTest, romsTest, userTest)

test('create manual save state during gameplay', async ({ page, pages: { library, login }, roms, user }) => {
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))

  await page.getByText('babelblox').click()
  await library.launchGame('start')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Take snapshot' }).click()

  // The pause menu shows how many snapshots there are, the one just taken among them
  await expect(page.locator('.game-overlay-saves')).toContainText('1 snapshot')

  await page.getByText('save & exit').click()
  await page.locator('#canvas').waitFor({ state: 'detached' })

  await library.launchGame('continue')

  // Save & Exit kept one more, which Continue started from
  await page.keyboard.press('Escape')
  await expect(page.locator('.game-overlay-saves')).toContainText('2 snapshots')
})
