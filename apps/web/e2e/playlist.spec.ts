import {expect, test} from '@playwright/test'

import {
  API_ROUTES,
  createMockSSEBody,
  MOCK_EMPTY_PLAYLISTS,
  MOCK_PLAYLISTS,
  MOCK_SSE_EVENTS,
  MOCK_TOKEN,
  MOCK_USER,
} from './fixtures/test-data'
import {AuthPage, ChatPage, PlaylistPage} from './pages'

/**
 * Helper to set up authenticated state
 */
async function setupAuthenticated(
  page: import('@playwright/test').Page,
  playlists = MOCK_PLAYLISTS,
) {
  const authPage = new AuthPage(page)
  const playlistPage = new PlaylistPage(page)

  await page.route(API_ROUTES.me, route => {
    route.fulfill({
      body: JSON.stringify(MOCK_USER),
      contentType: 'application/json',
      status: 200,
    })
  })

  await page.route(API_ROUTES.playlists, route => {
    route.fulfill({
      body: JSON.stringify(playlists),
      contentType: 'application/json',
      status: 200,
    })
  })

  await authPage.goto('/')
  await authPage.setAuthToken(MOCK_TOKEN)
  await page.reload()
  await authPage.waitForReady()

  return {authPage, playlistPage}
}

test.describe('Playlist Management', () => {
  test.describe('Loading Playlists', () => {
    test('shows loading state initially', async ({page}) => {
      const authPage = new AuthPage(page)
      const playlistPage = new PlaylistPage(page)

      // Set up slow response
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, async route => {
        await new Promise(r => setTimeout(r, 500))
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)
      await page.reload()

      // Should show loading state
      await playlistPage.assertLoading()
    })

    test('displays playlists after loading', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()
      await playlistPage.assertPlaylistsLoaded()

      const count = await playlistPage.getPlaylistCount()
      expect(count).toBe(3)
    })

    test('displays correct playlist names', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const names = await playlistPage.getPlaylistNames()
      expect(names).toContain('Workout Mix')
      expect(names).toContain('Chill Vibes')
      expect(names).toContain('Deep Focus')
    })

    test('displays playlist count in header', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const header = await page.locator(playlistPage.playlistsHeader).textContent()
      expect(header).toContain('3 playlists')
    })

    test('handles empty playlist response', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page, MOCK_EMPTY_PLAYLISTS)

      await playlistPage.waitForPlaylistsLoaded()

      const count = await playlistPage.getPlaylistCount()
      expect(count).toBe(0)
    })
  })

  test.describe('Playlist Selection', () => {
    test('can select a playlist by clicking', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      await playlistPage.selectPlaylistByName('Workout Mix')

      await playlistPage.assertPlaylistSelected('Workout Mix')
    })

    test('highlights selected playlist', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      await playlistPage.selectPlaylistByIndex(1)

      const selected = await page.locator(playlistPage.selectedPlaylist)
      await expect(selected).toBeVisible()
    })

    test('can change selection to different playlist', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      // Select first
      await playlistPage.selectPlaylistByName('Workout Mix')
      await playlistPage.assertPlaylistSelected('Workout Mix')

      // Select second
      await playlistPage.selectPlaylistByName('Chill Vibes')
      await playlistPage.assertPlaylistSelected('Chill Vibes')

      // First should no longer be selected
      const isWorkoutSelected = await playlistPage.isPlaylistSelected('Workout Mix')
      expect(isWorkoutSelected).toBe(false)
    })

    test('selecting playlist shows chat interface', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.waitForPlaylistsLoaded()

      // Before selection - no chat
      await playlistPage.assertNoPlaylistSelected()

      // After selection - chat visible
      await playlistPage.selectPlaylistByIndex(0)
      await chatPage.assertChatVisible()
    })

    test('keyboard navigation works', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      // Focus on first playlist
      const firstPlaylist = page.locator(playlistPage.playlistCard).first()
      await firstPlaylist.focus()

      // Press Enter to select
      await firstPlaylist.press('Enter')

      // Should be selected
      await expect(page.locator(playlistPage.selectedPlaylist)).toBeVisible()
    })
  })

  test.describe('Playlist Details', () => {
    test('displays track count', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const meta = await page.locator(playlistPage.playlistCard).first().locator(playlistPage.playlistMeta).textContent()
      expect(meta).toContain('50 tracks')
    })

    test('displays public/private status', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      // Workout Mix is public
      const publicPlaylist = page.locator(playlistPage.playlistCard).filter({hasText: 'Workout Mix'})
      await expect(publicPlaylist.locator(playlistPage.playlistMeta)).toContainText('Public')

      // Deep Focus is private
      const privatePlaylist = page.locator(playlistPage.playlistCard).filter({hasText: 'Deep Focus'})
      await expect(privatePlaylist.locator(playlistPage.playlistMeta)).toContainText('Private')
    })

    test('displays playlist description when available', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const description = await page
        .locator(playlistPage.playlistCard)
        .filter({hasText: 'Workout Mix'})
        .locator('.playlist-description')
        .textContent()

      expect(description).toContain('High energy workout music')
    })

    test('has link to open in Spotify', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const spotifyLink = page
        .locator(playlistPage.playlistCard)
        .first()
        .locator(playlistPage.openSpotifyButton)

      await expect(spotifyLink).toBeVisible()
      await expect(spotifyLink).toHaveAttribute('href', /open\.spotify\.com\/playlist/)
      await expect(spotifyLink).toHaveAttribute('target', '_blank')
    })
  })

  test.describe('Error Handling', () => {
    test('shows error when playlist load fails', async ({page}) => {
      const authPage = new AuthPage(page)
      const playlistPage = new PlaylistPage(page)

      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: 'Internal Server Error',
          status: 500,
        })
      })

      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)
      await page.reload()
      await authPage.waitForReady()

      await playlistPage.assertError()
    })

    test('can retry after error', async ({page}) => {
      const authPage = new AuthPage(page)
      const playlistPage = new PlaylistPage(page)

      let requestCount = 0

      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        requestCount++
        if (requestCount === 1) {
          route.fulfill({
            body: 'Internal Server Error',
            status: 500,
          })
        } else {
          route.fulfill({
            body: JSON.stringify(MOCK_PLAYLISTS),
            contentType: 'application/json',
            status: 200,
          })
        }
      })

      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)
      await page.reload()
      await authPage.waitForReady()

      // Should show error
      await playlistPage.assertError()

      // Click retry
      await playlistPage.clickRetry()

      // Should load playlists
      await playlistPage.assertPlaylistsLoaded()
    })

    test('handles 401 and logs out user', async ({page}) => {
      const authPage = new AuthPage(page)
      const playlistPage = new PlaylistPage(page)

      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify({error: {message: 'Invalid token', status: 401}}),
          status: 401,
        })
      })

      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)
      await page.reload()
      await authPage.waitForReady()

      // Should show error about session
      const hasError = await playlistPage.hasError()
      if (hasError) {
        const errorMsg = await playlistPage.getErrorMessage()
        expect(errorMsg).toContain('expired')
      }
    })
  })

  test.describe('Playlist Analysis', () => {
    test('selecting playlist allows analysis via chat', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.chatWithTool),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.waitForPlaylistsLoaded()
      await playlistPage.selectPlaylistByName('Workout Mix')

      // Send analysis request
      await chatPage.sendMessage('Analyze this playlist')

      // Wait for response
      await chatPage.waitForAssistantMessage()

      // Should get analysis response
      const response = await chatPage.getLastAssistantMessage()
      expect(response).toContain('Workout Mix')
    })
  })

  test.describe('Responsive Behavior', () => {
    test('displays playlist grid correctly', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)

      await playlistPage.waitForPlaylistsLoaded()

      const grid = page.locator(playlistPage.playlistsGrid)
      await expect(grid).toBeVisible()

      // Check all cards are visible
      const cards = page.locator(playlistPage.playlistCard)
      await expect(cards).toHaveCount(3)

      for (let i = 0; i < 3; i++) {
        await expect(cards.nth(i)).toBeVisible()
      }
    })
  })
})

test.describe('Playlist Creation', () => {
  test.describe('Create Mode', () => {
    test('can switch to create mode', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.waitForPlaylistsLoaded()
      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.setMode('create')

      const mode = await chatPage.getCurrentMode()
      expect(mode).toBe('create')
    })

    test('shows create-specific placeholder', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.waitForPlaylistsLoaded()
      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.setMode('create')

      await expect(page.locator(chatPage.chatInput)).toHaveAttribute(
        'placeholder',
        /Describe the playlist you want to create/,
      )
    })
  })
})
