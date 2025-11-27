import type {Page} from '@playwright/test'
import {expect} from '@playwright/test'

import {BasePage} from './BasePage'

/**
 * Page object for playlist-related interactions
 */
export class PlaylistPage extends BasePage {
  // Selectors
  readonly playlistsSection = '.playlists-section'
  readonly userPlaylists = '.user-playlists'
  readonly playlistsHeader = '.playlists-header'
  readonly playlistsGrid = '.playlists-grid'
  readonly playlistCard = '.playlist-card'
  readonly selectedPlaylist = '.playlist-card.selected'
  readonly playlistName = '.playlist-name'
  readonly playlistMeta = '.playlist-meta'
  readonly loadingState = '.loading-state'
  readonly errorState = '.error-state'
  readonly retryButton = '.retry-button'
  readonly openSpotifyButton = '.open-spotify-button'
  readonly noPlaylistSelected = '.no-playlist-selected'

  constructor(page: Page) {
    super(page)
  }

  /**
   * Wait for playlists to load
   */
  async waitForPlaylistsLoaded() {
    // Wait for either playlists to show or error state
    await Promise.race([
      this.page.waitForSelector(this.playlistsGrid, {state: 'visible'}),
      this.page.waitForSelector(this.errorState, {state: 'visible'}),
    ])
  }

  /**
   * Check if playlists are loading
   */
  async isLoading() {
    return this.isVisible(this.loadingState)
  }

  /**
   * Check if error state is shown
   */
  async hasError() {
    return this.isVisible(this.errorState)
  }

  /**
   * Get error message
   */
  async getErrorMessage(): Promise<string | null> {
    const visible = await this.hasError()
    if (!visible) return null
    return this.page.textContent(this.errorState)
  }

  /**
   * Click retry button
   */
  async clickRetry() {
    await this.page.click(this.retryButton)
  }

  /**
   * Get count of displayed playlists
   */
  async getPlaylistCount(): Promise<number> {
    return this.page.locator(this.playlistCard).count()
  }

  /**
   * Get all playlist names
   */
  async getPlaylistNames(): Promise<string[]> {
    const locators = this.page.locator(this.playlistName)
    const count = await locators.count()
    const names: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await locators.nth(i).textContent()
      if (text) names.push(text)
    }
    return names
  }

  /**
   * Select a playlist by name
   */
  async selectPlaylistByName(name: string) {
    await this.page.locator(this.playlistCard).filter({hasText: name}).click()
  }

  /**
   * Select a playlist by index
   */
  async selectPlaylistByIndex(index: number) {
    await this.page.locator(this.playlistCard).nth(index).click()
  }

  /**
   * Get the selected playlist name
   */
  async getSelectedPlaylistName(): Promise<string | null> {
    const selected = this.page.locator(this.selectedPlaylist)
    const visible = await selected.isVisible()
    if (!visible) return null
    return selected.locator(this.playlistName).textContent()
  }

  /**
   * Check if a playlist is selected
   */
  async isPlaylistSelected(name: string): Promise<boolean> {
    const selected = await this.getSelectedPlaylistName()
    return selected === name
  }

  /**
   * Assert playlists are loaded
   */
  async assertPlaylistsLoaded() {
    await expect(this.page.locator(this.playlistsGrid)).toBeVisible()
  }

  /**
   * Assert loading state
   */
  async assertLoading() {
    await expect(this.page.locator(this.loadingState)).toBeVisible()
  }

  /**
   * Assert error state
   */
  async assertError(expectedText?: string) {
    await expect(this.page.locator(this.errorState)).toBeVisible()
    if (expectedText) {
      await expect(this.page.locator(this.errorState)).toContainText(expectedText)
    }
  }

  /**
   * Assert playlist is selected
   */
  async assertPlaylistSelected(name: string) {
    await expect(this.page.locator(this.selectedPlaylist)).toBeVisible()
    await expect(
      this.page.locator(this.selectedPlaylist).locator(this.playlistName),
    ).toHaveText(name)
  }

  /**
   * Assert no playlist selected message
   */
  async assertNoPlaylistSelected() {
    await expect(this.page.locator(this.noPlaylistSelected)).toBeVisible()
  }
}
