import { expect, mergeTests, type Request } from '@playwright/test'
import { test as pagesTest } from '../fixtures/pages.ts'
import { test as romsTest } from '../fixtures/roms.ts'
import { test as userTest } from '../fixtures/user.ts'

const test = mergeTests(pagesTest, romsTest, userTest)

// A game's own file and its emulator's: what getting a game ready downloads. Pictures, such as its cover, aren't
function isGameDownload(request: Request) {
  const { pathname } = new URL(request.url())
  const gameFile = pathname.startsWith('/api/v1/files/') && request.resourceType() !== 'image'
  return gameFile || pathname.includes('_libretro')
}

test('nothing is downloaded on a game’s page when a controller connects, until Start is reached for', async ({
  page,
  pages: { library, login },
  roms,
  user,
}) => {
  // A controller the page can be told to connect: browsers list none until a button is pressed on one
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      connected: true,
      id: 'Test controller',
      index: 0,
      mapping: 'standard',
      timestamp: 0,
    }
    let connected = false
    Object.defineProperty(navigator, 'getGamepads', { value: () => (connected ? [pad, null, null, null] : []) })
    Object.assign(globalThis, {
      connectTestController() {
        connected = true
        globalThis.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }))
      },
    })
  })
  await login.login(user)
  await library.uploadROMs(roms.slice(0, 1))
  await page.getByText('babelblox').click()
  await expect(page.getByTestId('play-start')).toBeVisible()

  const downloads: string[] = []
  page.on('request', (request) => {
    if (isGameDownload(request)) {
      downloads.push(request.url())
    }
  })

  await page.evaluate(() => Reflect.get(globalThis, 'connectTestController')())
  await page.waitForTimeout(2000)
  expect(downloads).toEqual([])

  // Reaching for Start is what gets the game ready
  await page.getByTestId('play-start').hover()
  await expect.poll(() => downloads.length).toBeGreaterThan(0)
})
