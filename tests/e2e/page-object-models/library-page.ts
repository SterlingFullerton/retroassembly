import type { Page } from '@playwright/test'

export class LibraryPage {
  readonly homeURL = 'library'
  readonly page: Page
  readonly romsURL = 'library/roms'

  constructor(page: Page) {
    this.page = page
  }

  async closeSettings() {
    const { page } = this
    await page.getByTitle('close').click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
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
    await page.getByText(button).click()
    await recorded
    await page.locator('#canvas').waitFor()
  }

  async goto() {
    await this.page.goto(this.romsURL, { waitUntil: 'load' })
  }

  async gotoSettingsTab(tab: string) {
    const { page } = this
    await this.openMenu()
    await page.getByText('setting').click()
    await page.getByText(tab).first().click()
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
