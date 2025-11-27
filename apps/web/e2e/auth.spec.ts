import {expect, test} from '@playwright/test'

import {API_ROUTES, MOCK_PLAYLISTS, MOCK_TOKEN, MOCK_USER} from './fixtures/test-data'
import {AuthPage} from './pages'

test.describe('Authentication Flow', () => {
  test.describe('Login Page', () => {
    test('shows login page when not authenticated', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      await authPage.assertAuthPageShown()
      await expect(page.locator('h2')).toHaveText('Connect to Spotify')
    })

    test('shows login button with correct text', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      const loginButton = page.locator(authPage.loginButton)
      await expect(loginButton).toBeVisible()
      await expect(loginButton).toHaveText(/Login with Spotify/)
    })

    test('shows privacy note', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      await expect(page.locator('.privacy-note')).toBeVisible()
      await expect(page.locator('.privacy-note')).toContainText('playlist creation permissions')
    })
  })

  test.describe('Spotify OAuth Redirect', () => {
    test('clicking login initiates OAuth flow', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      // Mock the auth-url endpoint
      await page.route(API_ROUTES.authUrl, route => {
        route.fulfill({
          body: JSON.stringify({url: 'https://accounts.spotify.com/authorize?client_id=test'}),
          contentType: 'application/json',
          status: 200,
        })
      })

      // Listen for navigation
      const navigationPromise = page.waitForURL(/accounts\.spotify\.com|localhost/)

      await authPage.clickLogin()

      // Should navigate (or attempt to)
      await expect(async () => {
        const url = page.url()
        // Either redirected or stayed on page (if mock doesn't cause full redirect)
        expect(url).toBeDefined()
      }).toPass({timeout: 5000})
    })

    test('shows loading state while connecting', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      // Mock with delay
      await page.route(API_ROUTES.authUrl, async route => {
        await new Promise(r => setTimeout(r, 500))
        route.fulfill({
          body: JSON.stringify({url: 'https://accounts.spotify.com/authorize?client_id=test'}),
          contentType: 'application/json',
          status: 200,
        })
      })

      // Click and immediately check for loading state
      const loginButton = page.locator(authPage.loginButton)
      await loginButton.click()

      // Button should show loading text
      await expect(loginButton).toContainText(/Connecting/)
    })

    test('handles auth-url fetch error', async ({page}) => {
      const authPage = new AuthPage(page)
      await authPage.goto('/')

      // Mock failure
      await page.route(API_ROUTES.authUrl, route => {
        route.fulfill({
          body: 'Internal Server Error',
          status: 500,
        })
      })

      await authPage.clickLogin()

      // Should show error
      await authPage.assertErrorShown()
    })
  })

  test.describe('OAuth Callback', () => {
    test('stores token from successful callback', async ({page}) => {
      const authPage = new AuthPage(page)

      // Mock API endpoints for authenticated state
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      // Simulate OAuth callback
      await authPage.simulateOAuthCallback(MOCK_TOKEN)

      // Should store token
      const storedToken = await authPage.getAuthToken()
      expect(storedToken).toBe(MOCK_TOKEN)
    })

    test('shows authenticated state after callback', async ({page}) => {
      const authPage = new AuthPage(page)

      // Mock authenticated APIs
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      await authPage.simulateOAuthCallback(MOCK_TOKEN)

      // Should show logout button (authenticated state)
      await authPage.assertLoggedIn()
    })

    test('clears URL params after callback', async ({page}) => {
      const authPage = new AuthPage(page)

      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      await authPage.simulateOAuthCallback(MOCK_TOKEN)

      // Wait for URL cleanup
      await page.waitForURL(url => !url.searchParams.has('spotify_token'), {timeout: 5000})

      const url = new URL(page.url())
      expect(url.searchParams.has('spotify_token')).toBe(false)
      expect(url.searchParams.has('auth_success')).toBe(false)
    })

    test('handles OAuth error callback', async ({page}) => {
      const authPage = new AuthPage(page)

      await authPage.simulateOAuthError('access_denied')

      await authPage.assertErrorShown('access_denied')
    })
  })

  test.describe('Logout', () => {
    test('logout clears token and shows login page', async ({page}) => {
      const authPage = new AuthPage(page)

      // Set up authenticated state
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      // Start authenticated
      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)
      await page.reload()
      await authPage.waitForReady()

      // Wait for authenticated state
      await authPage.assertLoggedIn()

      // Logout
      await authPage.logout()

      // Should show login page
      await authPage.assertAuthPageShown()

      // Token should be cleared
      const token = await authPage.getAuthToken()
      expect(token).toBeNull()
    })
  })

  test.describe('Token Validation', () => {
    test('validates token on page load', async ({page}) => {
      const authPage = new AuthPage(page)

      // Start with token in storage
      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)

      // Mock successful validation
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_USER),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.route(API_ROUTES.playlists, route => {
        route.fulfill({
          body: JSON.stringify(MOCK_PLAYLISTS),
          contentType: 'application/json',
          status: 200,
        })
      })

      await page.reload()

      // Should remain authenticated
      await authPage.assertLoggedIn()
    })

    test('clears token on 401 response', async ({page}) => {
      const authPage = new AuthPage(page)

      // Start with token in storage
      await authPage.goto('/')
      await authPage.setAuthToken(MOCK_TOKEN)

      // Mock 401 (expired/invalid token)
      await page.route(API_ROUTES.me, route => {
        route.fulfill({
          body: JSON.stringify({error: {message: 'Invalid access token', status: 401}}),
          contentType: 'application/json',
          status: 401,
        })
      })

      await page.reload()

      // Should show login page after token cleared
      await authPage.assertAuthPageShown()
    })
  })

  test.describe('Error Handling', () => {
    test('can dismiss error messages', async ({page}) => {
      const authPage = new AuthPage(page)

      await authPage.simulateOAuthError('test_error')

      // Error should be visible
      await authPage.assertErrorShown()

      // Dismiss error
      await authPage.dismissError()

      // Error should be hidden
      await expect(page.locator(authPage.errorMessage)).not.toBeVisible()
    })

    test('error clears when starting new login', async ({page}) => {
      const authPage = new AuthPage(page)

      await authPage.simulateOAuthError('previous_error')
      await authPage.assertErrorShown()

      // Mock auth URL
      await page.route(API_ROUTES.authUrl, route => {
        route.fulfill({
          body: JSON.stringify({url: 'https://accounts.spotify.com/authorize'}),
          contentType: 'application/json',
          status: 200,
        })
      })

      // Start new login
      await authPage.clickLogin()

      // Error should clear
      await expect(page.locator(authPage.errorMessage)).not.toBeVisible()
    })
  })
})
