import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { Hono } from 'hono'

import type { Env } from '../index'

const testRouter = new Hono<{ Bindings: Env }>()

// Test page HTML
const testPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DJ API Worker Tests</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #1a1a1a;
            color: white;
        }
        .test-section {
            margin: 20px 0;
            padding: 20px;
            background: #2a2a2a;
            border-radius: 8px;
        }
        button {
            background: #1db954;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
        }
        button:hover { background: #1ed760; }
        textarea {
            width: 100%;
            min-height: 100px;
            background: #333;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 10px;
        }
        .result {
            background: #333;
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
            white-space: pre-wrap;
        }
        .error { background: #5a1a1a; }
        .success { background: #1a5a1a; }
    </style>
</head>
<body>
    <h1>🎵 DJ API Worker Local Tests</h1>

    <div class="test-section">
        <h2>Health Check</h2>
        <button onclick="testHealth()">Test Health Endpoint</button>
        <div id="health-result" class="result"></div>
    </div>

    <div class="test-section">
        <h2>Environment Variables</h2>
        <button onclick="testEnv()">Check Environment</button>
        <div id="env-result" class="result"></div>
    </div>

    <div class="test-section">
        <h2>Chat with AI (No Spotify Required)</h2>
        <textarea id="chat-message" placeholder="Type a message to test the AI chat...">Hi! Can you help me create a chill playlist?</textarea>
        <br>
        <button onclick="testChat()">Send Chat Message</button>
        <div id="chat-result" class="result"></div>
    </div>

    <div class="test-section">
        <h2>Simple Anthropic Test</h2>
        <button onclick="testAnthropicDirect()">Test Direct Anthropic API</button>
        <div id="anthropic-result" class="result"></div>
    </div>

    <script>
        async function testHealth() {
            const result = document.getElementById('health-result');
            try {
                const response = await fetch('/health');
                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
                result.className = 'result success';
            } catch (error) {
                result.textContent = 'Error: ' + error.message;
                result.className = 'result error';
            }
        }

        async function testEnv() {
            const result = document.getElementById('env-result');
            try {
                const response = await fetch('/api/test/env');
                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
                result.className = 'result success';
            } catch (error) {
                result.textContent = 'Error: ' + error.message;
                result.className = 'result error';
            }
        }

        async function testChat() {
            const result = document.getElementById('chat-result');
            const message = document.getElementById('chat-message').value;

            if (!message.trim()) {
                result.textContent = 'Please enter a message';
                result.className = 'result error';
                return;
            }

            try {
                result.textContent = 'Sending message...';
                result.className = 'result';

                const response = await fetch('/api/chat/message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message.trim(),
                        conversationHistory: []
                    })
                });

                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
                result.className = response.ok ? 'result success' : 'result error';
            } catch (error) {
                result.textContent = 'Error: ' + error.message;
                result.className = 'result error';
            }
        }

        async function testAnthropicDirect() {
            const result = document.getElementById('anthropic-result');
            try {
                result.textContent = 'Testing Anthropic API...';
                result.className = 'result';

                const response = await fetch('/api/test/anthropic');
                const data = await response.json();
                result.textContent = JSON.stringify(data, null, 2);
                result.className = response.ok ? 'result success' : 'result error';
            } catch (error) {
                result.textContent = 'Error: ' + error.message;
                result.className = 'result error';
            }
        }
    </script>
</body>
</html>
`

// Test page route
testRouter.get('/', c => {
  return c.html(testPageHTML)
})

// Environment check
testRouter.get('/env', c => {
  return c.json({
    anthropicKeyLength: c.env.ANTHROPIC_API_KEY?.length || 0,
    environment: c.env.ENVIRONMENT || 'unknown',
    hasAnthropicKey: !!c.env.ANTHROPIC_API_KEY,
    hasSpotifyClientId: !!c.env.SPOTIFY_CLIENT_ID,
    hasSpotifyClientSecret: !!c.env.SPOTIFY_CLIENT_SECRET,
    spotifyClientIdLength: c.env.SPOTIFY_CLIENT_ID?.length || 0,
  })
})

// Direct Anthropic API test
testRouter.get('/anthropic', async c => {
  try {
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: 'ANTHROPIC_API_KEY not found' }, 500)
    }

    const chat = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      maxTokens: 100,
      model: 'claude-3-haiku-20240307',
      temperature: 0.7,
    })

    const messages = [
      new SystemMessage('You are a helpful assistant. Respond briefly.'),
      new HumanMessage('Hello! Can you confirm you are working?'),
    ]

    const response = await chat.invoke(messages)

    return c.json({
      message: response.content,
      model: 'claude-3-haiku-20240307',
      success: true,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Anthropic test error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json(
      {
        error: message,
        success: false,
        timestamp: new Date().toISOString(),
      },
      500,
    )
  }
})

// Mock Spotify search (without auth)
testRouter.post('/spotify-mock', async c => {
  try {
    const { query } = await c.req.json()

    // Return mock Spotify data
    return c.json({
      tracks: {
        items: [
          {
            artists: [{ name: 'Mock Artist' }],
            external_urls: { spotify: 'https://open.spotify.com/track/mock1' },
            id: 'mock-track-1',
            name: `Mock Track for "${query}"`,
            preview_url: 'https://example.com/preview.mp3',
            uri: 'spotify:track:mock1',
          },
        ],
      },
    })
  } catch (error) {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export { testRouter }
