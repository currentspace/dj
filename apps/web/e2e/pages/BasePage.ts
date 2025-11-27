import type {Page} from '@playwright/test'

/**
 * Base page object with common functionality
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  /**
   * Navigate to a specific path
   */
  async goto(path: string = '/') {
    await this.page.goto(path)
  }

  /**
   * Wait for page to be ready
   */
  async waitForReady() {
    await this.page.waitForLoadState('domcontentloaded')
  }

  /**
   * Get the page title
   */
  async getTitle() {
    return this.page.title()
  }

  /**
   * Check if an element is visible
   */
  async isVisible(selector: string) {
    return this.page.isVisible(selector)
  }

  /**
   * Take a screenshot
   */
  async screenshot(name: string) {
    await this.page.screenshot({path: `test-results/${name}.png`})
  }

  /**
   * Mock localStorage with auth token
   */
  async setAuthToken(token: string, expiresInMs: number = 3600000) {
    const tokenData = {
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresInMs,
      token,
    }
    await this.page.evaluate(data => {
      localStorage.setItem('spotify_token_data', JSON.stringify(data))
    }, tokenData)
  }

  /**
   * Clear auth token from localStorage
   */
  async clearAuthToken() {
    await this.page.evaluate(() => {
      localStorage.removeItem('spotify_token_data')
      localStorage.removeItem('spotify_token')
    })
  }

  /**
   * Get auth token from localStorage
   */
  async getAuthToken(): Promise<string | null> {
    return this.page.evaluate(() => {
      const data = localStorage.getItem('spotify_token_data')
      if (!data) return null
      try {
        const parsed = JSON.parse(data)
        return parsed.token
      } catch {
        return null
      }
    })
  }
}
