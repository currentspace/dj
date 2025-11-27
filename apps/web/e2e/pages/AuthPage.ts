import type {Page} from '@playwright/test'
import {expect} from '@playwright/test'

import {BasePage} from './BasePage'

/**
 * Page object for authentication-related interactions
 */
export class AuthPage extends BasePage {
  // Selectors
  readonly loginButton = '.spotify-login-btn'
  readonly authContainer = '.auth-container'
  readonly errorMessage = '.error-message'
  readonly dismissButton = '.dismiss-button'
  readonly logoutButton = '.logout-button'
  readonly appHeader = '.app-header'

  constructor(page: Page) {
    super(page)
  }

  /**
   * Check if auth page is displayed (not logged in)
   */
  async isAuthPageVisible() {
    return this.isVisible(this.authContainer)
  }

  /**
   * Check if user is logged in (shows logout button)
   */
  async isLoggedIn() {
    return this.isVisible(this.logoutButton)
  }

  /**
   * Click the Spotify login button
   */
  async clickLogin() {
    await this.page.click(this.loginButton)
  }

  /**
   * Wait for redirect to Spotify OAuth
   * Returns the URL that was navigated to
   */
  async waitForOAuthRedirect(): Promise<string> {
    const [request] = await Promise.all([
      this.page.waitForRequest(request =>
        request.url().includes('/api/spotify/auth-url') ||
        request.url().includes('accounts.spotify.com'),
      ),
      this.clickLogin(),
    ])
    return request.url()
  }

  /**
   * Simulate OAuth callback by navigating with token params
   */
  async simulateOAuthCallback(token: string) {
    await this.page.goto(`/?auth_success=true&spotify_token=${token}`)
    await this.page.waitForLoadState('domcontentloaded')
  }

  /**
   * Simulate OAuth error callback
   */
  async simulateOAuthError(error: string) {
    await this.page.goto(`/?error=${encodeURIComponent(error)}`)
    await this.page.waitForLoadState('domcontentloaded')
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string | null> {
    const visible = await this.isVisible(this.errorMessage)
    if (!visible) return null
    return this.page.textContent(this.errorMessage)
  }

  /**
   * Dismiss error message
   */
  async dismissError() {
    await this.page.click(this.dismissButton)
  }

  /**
   * Click logout button
   */
  async logout() {
    await this.page.click(this.logoutButton)
  }

  /**
   * Assert auth page is shown
   */
  async assertAuthPageShown() {
    await expect(this.page.locator(this.authContainer)).toBeVisible()
    await expect(this.page.locator(this.loginButton)).toBeVisible()
  }

  /**
   * Assert user is logged in
   */
  async assertLoggedIn() {
    await expect(this.page.locator(this.logoutButton)).toBeVisible()
  }

  /**
   * Assert error is shown
   */
  async assertErrorShown(expectedText?: string) {
    await expect(this.page.locator(this.errorMessage)).toBeVisible()
    if (expectedText) {
      await expect(this.page.locator(this.errorMessage)).toContainText(expectedText)
    }
  }
}
