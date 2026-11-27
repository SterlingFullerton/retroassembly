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
  await page.getByTestId('pause-save').click()

  // The pause menu's Load shows how many snapshots there are, the one just taken among them
  await expect(page.getByTestId('pause-load')).toContainText('1')

  await page.getByTestId('pause-exit').click()
  await page.getByTestId('pause-save-exit').click()
  await page.locator('#canvas').waitFor({ state: 'detached' })

  await library.launchGame('continue')

  // Save & Exit kept one more, which Continue started from
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pause-load')).toContainText('2')
})
