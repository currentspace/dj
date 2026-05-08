import {expect, test} from '@playwright/test'

/**
 * E2E happy path for the always-on DJ UX (DJPage).
 *
 * SKIPPED until the Spotify auth + mix-session API mocks are wired up in
 * playwright/fixtures. The existing auth.spec.ts / chat.spec.ts / playlist.spec.ts
 * cover the old two-page chat/playlist UX which has been removed; this file is
 * the seed for the new e2e suite that exercises DJPage + features/{auth,mix,playback}.
 *
 * Run with: pnpm --filter @dj/web test:e2e --grep "DJ session happy path"
 */
test.describe.skip('DJ session happy path', () => {
  test('login → start session → see queue + suggestions → steer the vibe', async ({page}) => {
    await page.goto('/')

    // Login screen renders before auth
    await expect(page.getByRole('heading', {name: 'Connect to Spotify'})).toBeVisible()

    // (TODO: mock the Spotify OAuth callback by writing a token blob to localStorage
    // and navigating back to / — the page will pick it up via the no-useEffect
    // first-render bootstrap in useSpotifyAuth.)

    // Once authed, the DJPage shows the playlist picker + Start button
    await expect(page.getByRole('button', {name: /Start DJ/i})).toBeVisible()
    await page.getByRole('button', {name: /Start DJ/i}).click()

    // Active session: queue + suggestions panels render
    await expect(page.getByText('Queue')).toBeVisible()
    await expect(page.getByText('Coming Up')).toBeVisible()

    // Steer input takes a free-text vibe direction
    await page.getByPlaceholder(/Steer the vibe/).fill('more acoustic guitar')
    await page.getByRole('button', {name: 'Steer'}).click()

    // The DJ log records the steer event
    await expect(page.getByText(/Processing: "more acoustic guitar"/)).toBeVisible()
  })
})
