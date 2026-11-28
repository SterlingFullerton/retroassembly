import type { Page } from '@playwright/test'

export class LibraryPage {
  readonly homeURL = 'library'
  readonly page: Page
  readonly romsURL = 'library/roms'

  constructor(page: Page) {
    this.page = page
  }

  /**
   * Starts the game on its page with Start or Continue, and waits until it's playing: the play is recorded once the
   * game has started, and only then does it take keys such as Escape for its menu
   */
  async launchGame(button: 'continue' | 'start') {
    const { page } = this
    const recorded = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/api/v1/launch_records'),
    )
    // On a game's page, Continue is the one button when there's a snapshot, and Start fresh is in the menu beside it
    if (button === 'continue') {
      await page.getByTestId('play-continue').click()
    } else if (await page.getByTestId('play-start').isVisible()) {
      await page.getByTestId('play-start').click()
    } else {
      await page.getByTestId('play-more').click()
      await page.getByTestId('play-start-fresh').click()
    }
    await recorded
    await page.locator('#canvas').waitFor()
  }

  async goto() {
    await this.page.goto(this.romsURL, { waitUntil: 'load' })
  }

  /** Opens one of the settings' sections, such as `account` */
  async gotoSettings(section: string) {
    await this.page.goto(`library/settings/${section}`, { waitUntil: 'load' })
  }

  async logout() {
    const { page } = this
    await this.openMenu()
    await page.getByText('log out').click()
    await page.locator('button').getByText('log out').click()
  }

  async openMenu() {
    await this.page.getByLabel('menu').filter({ visible: true }).click()
  }

  async uploadROMs(roms: { path: string; platform: string; platformName: string }[]) {
    const { page } = this
    const romsByPlatform: Record<string, { paths: string[]; platform: string }> = {}
    for (const rom of roms) {
      const key = rom.platformName
      romsByPlatform[key] ||= { paths: [], platform: rom.platform }
      romsByPlatform[key].paths.push(rom.path)
    }

    for (const [platformName, { paths }] of Object.entries(romsByPlatform)) {
      await this.goto()
      await page.locator('button').getByText('add').first().click()
      await page.getByRole('menuitem', { exact: true, name: platformName }).click()
      await page.getByRole('dialog').waitFor({ state: 'visible' })
      const fileChooserPromise = page.waitForEvent('filechooser')
      await page.getByText('select files').click()
      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(paths)
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    }
  }
}
