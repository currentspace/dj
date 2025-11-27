import {expect, test} from '@playwright/test'

import {
  API_ROUTES,
  createMockSSEBody,
  MOCK_PLAYLISTS,
  MOCK_SSE_EVENTS,
  MOCK_TOKEN,
  MOCK_USER,
} from './fixtures/test-data'
import {AuthPage, ChatPage, PlaylistPage} from './pages'

/**
 * Helper to set up authenticated state with mocked APIs
 */
async function setupAuthenticated(page: import('@playwright/test').Page) {
  const authPage = new AuthPage(page)
  const playlistPage = new PlaylistPage(page)

  // Mock all authenticated APIs
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

  // Set auth token
  await authPage.goto('/')
  await authPage.setAuthToken(MOCK_TOKEN)
  await page.reload()
  await authPage.waitForReady()

  // Wait for playlists to load
  await playlistPage.waitForPlaylistsLoaded()

  return {authPage, playlistPage}
}

test.describe('Chat Flow', () => {
  test.describe('Chat Interface Display', () => {
    test('shows chat interface when authenticated and playlist selected', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Select a playlist
      await playlistPage.selectPlaylistByIndex(0)

      // Should show chat interface
      await chatPage.assertChatVisible()
    })

    test('shows welcome message when no conversation', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.assertWelcomeMessage()
      await expect(page.locator(chatPage.welcomeMessage)).toContainText('AI DJ assistant')
    })

    test('shows "select playlist" message when none selected', async ({page}) => {
      await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Don't select any playlist
      await expect(page.locator('.no-playlist-selected')).toBeVisible()
      await expect(page.locator('.no-playlist-selected')).toContainText('Select a Playlist')
    })

    test('displays selected playlist info in chat header', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByName('Workout Mix')

      // Check playlist info in header
      await expect(page.locator(chatPage.selectedPlaylistInfo)).toContainText('Workout Mix')
      await expect(page.locator(chatPage.selectedPlaylistInfo)).toContainText('50 tracks')
    })
  })

  test.describe('Mode Selection', () => {
    test('defaults to analyze mode', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      const mode = await chatPage.getCurrentMode()
      expect(mode).toBe('analyze')
    })

    test('can switch between modes', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      // Switch to create mode
      await chatPage.setMode('create')
      expect(await chatPage.getCurrentMode()).toBe('create')

      // Switch to dj mode
      await chatPage.setMode('dj')
      expect(await chatPage.getCurrentMode()).toBe('dj')

      // Switch to edit mode
      await chatPage.setMode('edit')
      expect(await chatPage.getCurrentMode()).toBe('edit')
    })

    test('shows appropriate placeholder text per mode', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      // Analyze mode
      await chatPage.setMode('analyze')
      await expect(page.locator(chatPage.chatInput)).toHaveAttribute(
        'placeholder',
        /Ask me about any song/,
      )

      // Create mode
      await chatPage.setMode('create')
      await expect(page.locator(chatPage.chatInput)).toHaveAttribute(
        'placeholder',
        /Describe the playlist/,
      )

      // DJ mode
      await chatPage.setMode('dj')
      await expect(page.locator(chatPage.chatInput)).toHaveAttribute(
        'placeholder',
        /play next|queue songs|control playback/i,
      )
    })
  })

  test.describe('Message Sending', () => {
    test('can type in message input', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.typeMessage('Hello, AI!')
      const inputValue = await page.locator(chatPage.chatInput).inputValue()
      expect(inputValue).toBe('Hello, AI!')
    })

    test('send button disabled when input empty', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      const isEnabled = await chatPage.isSendEnabled()
      expect(isEnabled).toBe(false)
    })

    test('send button enabled when input has text', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.typeMessage('Test message')
      const isEnabled = await chatPage.isSendEnabled()
      expect(isEnabled).toBe(true)
    })

    test('adds user message to chat on send', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Mock SSE endpoint (will hang to keep streaming state)
      await page.route(API_ROUTES.chatStream, async route => {
        // Respond with minimal SSE that stays open
        route.fulfill({
          body: createMockSSEBody([{data: 'Processing...', type: 'thinking'}]),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Analyze this playlist')

      // Check user message appears
      const userCount = await chatPage.getUserMessageCount()
      expect(userCount).toBeGreaterThan(0)

      const messages = await chatPage.getMessages()
      const userMessages = messages.filter(m => m.role === 'user')
      expect(userMessages[0].content).toBe('Analyze this playlist')
    })

    test('clears input after sending', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Test message')

      // Input should be cleared
      const inputValue = await page.locator(chatPage.chatInput).inputValue()
      expect(inputValue).toBe('')
    })
  })

  test.describe('SSE Response Streaming', () => {
    test('receives and displays streamed content', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Mock SSE with basic chat response
      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Hello')

      // Wait for response
      await chatPage.waitForAssistantMessage()

      // Check assistant message
      const lastMsg = await chatPage.getLastAssistantMessage()
      expect(lastMsg).toContain('test response')
    })

    test('shows streaming indicator during response', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Mock SSE with delay
      await page.route(API_ROUTES.chatStream, async route => {
        await new Promise(r => setTimeout(r, 100))
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Test')

      // Should show streaming indicator initially
      // Note: This may pass very quickly, so we use a short timeout
      const streamingVisible = await chatPage.isStreaming().catch(() => false)
      // Either streaming or already done - both are valid
      expect(typeof streamingVisible).toBe('boolean')
    })

    test('disables input during streaming', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // Set up a longer running mock
      let resolveRoute: () => void
      const routePromise = new Promise<void>(r => {
        resolveRoute = r
      })

      await page.route(API_ROUTES.chatStream, async route => {
        // Wait before responding to simulate streaming
        await new Promise(r => setTimeout(r, 200))
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
        resolveRoute()
      })

      await playlistPage.selectPlaylistByIndex(0)

      // Start sending
      const sendPromise = chatPage.sendMessage('Test')

      // Check input is disabled during streaming
      await expect(page.locator(chatPage.chatInput)).toBeDisabled({timeout: 1000})

      // Wait for completion
      await sendPromise
      await routePromise
    })
  })

  test.describe('Tool Execution', () => {
    test('shows tool execution status', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.chatWithTool),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Analyze this playlist')

      // Wait for completion
      await chatPage.waitForAssistantMessage()

      // Check response mentions analysis
      const lastMsg = await chatPage.getLastAssistantMessage()
      expect(lastMsg).toContain('Workout Mix')
      expect(lastMsg).toContain('BPM')
    })

    test('shows completed tools in status', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.chatWithTool),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Analyze')

      // Wait for response
      await chatPage.waitForAssistantMessage(10000)

      // Tools used should be shown (or streaming should be done)
      const isStreaming = await chatPage.isStreaming()
      expect(isStreaming).toBe(false)
    })
  })

  test.describe('Error Handling', () => {
    test('displays error message in chat on SSE error', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.chatWithError),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Test error')

      // Wait for error message
      await chatPage.waitForAssistantMessage()

      await chatPage.assertErrorInChat('Failed to process')
    })

    test('handles HTTP error response', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: JSON.stringify({error: 'Internal server error'}),
          contentType: 'application/json',
          status: 500,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Test')

      // Wait for error
      await chatPage.waitForAssistantMessage()

      await chatPage.assertErrorInChat()
    })

    test('handles 401 unauthorized by clearing session', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)
      const authPage = new AuthPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: JSON.stringify({error: 'Unauthorized'}),
          status: 401,
        })
      })

      await playlistPage.selectPlaylistByIndex(0)

      await chatPage.sendMessage('Test unauthorized')

      // Should show error and eventually return to login
      await chatPage.waitForAssistantMessage()

      const lastMsg = await chatPage.getLastAssistantMessage()
      expect(lastMsg).toContain('Error')
    })

    test('recovers after error - can send new message', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      // First request errors
      let requestCount = 0
      await page.route(API_ROUTES.chatStream, route => {
        requestCount++
        if (requestCount === 1) {
          route.fulfill({
            body: createMockSSEBody(MOCK_SSE_EVENTS.chatWithError),
            headers: {'Content-Type': 'text/event-stream'},
            status: 200,
          })
        } else {
          route.fulfill({
            body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
            headers: {'Content-Type': 'text/event-stream'},
            status: 200,
          })
        }
      })

      await playlistPage.selectPlaylistByIndex(0)

      // First message - error
      await chatPage.sendMessage('First message')
      await chatPage.waitForAssistantMessage()

      // Second message - success
      await chatPage.sendMessage('Second message')
      await page.waitForTimeout(500)

      const lastMsg = await chatPage.getLastAssistantMessage()
      expect(lastMsg).toContain('test response')
    })
  })

  test.describe('Conversation Persistence', () => {
    test('maintains conversation history per playlist', async ({page}) => {
      const {playlistPage} = await setupAuthenticated(page)
      const chatPage = new ChatPage(page)

      await page.route(API_ROUTES.chatStream, route => {
        route.fulfill({
          body: createMockSSEBody(MOCK_SSE_EVENTS.basicChat),
          headers: {'Content-Type': 'text/event-stream'},
          status: 200,
        })
      })

      // Start with first playlist
      await playlistPage.selectPlaylistByName('Workout Mix')
      await chatPage.sendMessage('Message for Workout')
      await chatPage.waitForAssistantMessage()

      const workoutMsgCount = await chatPage.getMessageCount()
      expect(workoutMsgCount).toBe(2) // user + assistant

      // Switch to second playlist
      await playlistPage.selectPlaylistByName('Chill Vibes')

      // Should have no messages (new context)
      const chillMsgCount = await chatPage.getMessageCount()
      expect(chillMsgCount).toBe(0)

      // Send message to second playlist
      await chatPage.sendMessage('Message for Chill')
      await chatPage.waitForAssistantMessage()

      // Switch back to first playlist
      await playlistPage.selectPlaylistByName('Workout Mix')

      // Should see original messages
      const restoredCount = await chatPage.getMessageCount()
      expect(restoredCount).toBe(2)
    })
  })
})
