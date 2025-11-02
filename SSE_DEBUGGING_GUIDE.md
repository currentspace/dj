# SSE Debugging Guide

## Architecture Overview

### Client-Server Flow

```
Client (React)                      Server (Cloudflare Worker)
──────────────                      ─────────────────────────

ChatInterface.tsx
     ↓
chatStreamClient.streamMessage()
     ↓
POST /api/chat-stream/message  →   chatStreamRouter.post('/message')
   Headers:                             ↓
   - Content-Type: application/json    Creates TransformStream
   - Accept: text/event-stream         ↓
   - Authorization: Bearer {token}     Returns Response(readable) immediately
   Body:                               ↓
   - message                           processStream() runs async:
   - conversationHistory                 - Sends SSE events
   - mode                                - Calls Claude API
     ↓                                   - Executes Spotify tools
Reads response.body stream        ←   Writes to writable stream
     ↓
Parses SSE events
     ↓
Updates UI
```

## Routes and Endpoints

### Production Routes

- **POST /api/chat-stream/message** - Main SSE streaming endpoint
- **POST /api/chat/message** - Simple non-streaming endpoint

### Test Routes

- **GET /api/sse-test/simple** - Basic SSE test (no auth required)
- **POST /api/sse-test/post-stream** - POST SSE test

## Testing Instructions

### 1. Using the Debug HTML Page

Open `http://localhost:3000/test-sse.html` in your browser.

1. **Get Token**: Click "Get from localStorage" to retrieve your Spotify token
2. **Test Basic SSE**:
   - Click "Test GET /api/sse-test/simple" - Should stream 5 messages
   - Click "Test POST /api/sse-test/post-stream" - Should echo request
3. **Test Chat Stream**:
   - Enter a message and optional playlist ID
   - Click "Start SSE Stream"
   - Watch the event log for SSE events

### 2. Using curl

```bash
# Test simple SSE
curl -N http://localhost:8787/api/sse-test/simple

# Test POST SSE with auth
curl -N -X POST 'http://localhost:8787/api/chat-stream/message' \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -H 'Authorization: Bearer YOUR_TOKEN_HERE' \
  -d '{
    "message": "test",
    "conversationHistory": [],
    "mode": "analyze"
  }'
```

### 3. Using Browser Console

```javascript
// Get token
const token = localStorage.getItem('spotify_token')

// Test SSE
const response = await fetch('http://localhost:8787/api/chat-stream/message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    message: 'What is the tempo?',
    conversationHistory: [],
    mode: 'analyze',
  }),
})

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  console.log(decoder.decode(value))
}
```

## Common Issues and Solutions

### Issue 1: No SSE Events Received

**Symptoms**: Connection established but no events **Check**:

- Browser console for errors
- Network tab shows 200 but no data
- Server logs show processing

**Solutions**:

1. Check if Cloudflare is buffering (add headers)
2. Ensure TransformStream is created properly
3. Verify async processing isn't throwing errors

### Issue 2: 401 Unauthorized

**Symptoms**: Request fails with 401 **Solutions**:

1. Get fresh token from Spotify
2. Check token in localStorage
3. Verify Authorization header format: `Bearer {token}`

### Issue 3: SSE Events Not Parsing

**Symptoms**: Raw text in console, events not recognized **Check**:

- Event format: `data: {JSON}\n\n`
- Double newline between events
- JSON is valid

### Issue 4: Stream Closes Immediately

**Symptoms**: Connection opens and closes without events **Check**:

- Server error logs
- Anthropic API key is set
- Request body is valid JSON

## Debug Logging Locations

### Client Side

Look for `[ChatStream]` prefixed logs:

```
[ChatStream] Starting stream request to /api/chat-stream/message
[ChatStream] Response status: 200 OK
[ChatStream] Chunk #1 received (X bytes)
[ChatStream] Parsed event: content "..."
```

### Server Side

Look for `[Stream:{id}]` prefixed logs:

```
[Stream:abc12345] ========== NEW STREAMING REQUEST ==========
[Stream:abc12345] Request body parsed: {...}
[Stream:abc12345] Starting async stream processing
[Stream:abc12345] Sending initial debug event
[Stream:abc12345] Claude stream initialized
```

## SSE Event Format

### Standard Events

```
data: {"type": "thinking", "data": "Processing..."}

data: {"type": "content", "data": "Response text"}

data: {"type": "tool_start", "data": {"tool": "analyze_playlist", "args": {}}}

data: {"type": "tool_end", "data": {"tool": "analyze_playlist", "result": "..."}}

data: {"type": "done", "data": null}
```

### Heartbeats

```
: heartbeat

```

## Verifying Each Component

### 1. Verify Worker is Running

```bash
pnpm run dev:api
# Should show: ⎔ Starting local server...
```

### 2. Verify Routes are Registered

Check `/workers/api/src/index.ts`:

```typescript
app.route('/api/chat-stream', chatStreamRouter)
```

### 3. Verify SSE Headers

Response should have:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Content-Encoding: identity`

### 4. Verify TransformStream

Server should:

1. Create TransformStream
2. Return Response(readable) immediately
3. Process async and write to writable

### 5. Verify Client Parsing

Client should:

1. Read chunks from response.body
2. Buffer until double newline
3. Parse JSON from data: lines
4. Handle event types

## Environment Variables

Ensure these are set in `.dev.vars`:

```
ANTHROPIC_API_KEY=your_key_here
SPOTIFY_CLIENT_ID=your_id_here
SPOTIFY_CLIENT_SECRET=your_secret_here
```

## Next Steps if Still Not Working

1. **Test with simple SSE first**: Use `/api/sse-test/simple` to verify SSE works at all
2. **Check network conditions**: Some proxies/firewalls block SSE
3. **Try different browser**: Some extensions interfere with streaming
4. **Check Cloudflare logs**: `wrangler tail` for production
5. **Simplify the request**: Remove tools, just stream a simple message
6. **Check auth independently**: Test Spotify API directly

## Contact for Help

If SSE is still not working after following this guide:

1. Check server logs for specific errors
2. Use the test HTML page to capture detailed logs
3. Try the curl commands to eliminate browser issues
4. Check if the issue is specific to Cloudflare Workers vs local dev
